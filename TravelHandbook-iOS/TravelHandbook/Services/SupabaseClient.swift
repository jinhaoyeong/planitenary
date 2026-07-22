import Foundation
import Security

// MARK: - Auth models (Supabase)

struct AuthUser: Codable, Identifiable, Equatable {
    let id: String
    let email: String?
    let createdAt: String?
    var appMetadata: [String: JSONAny]?
    var userMetadata: [String: JSONAny]?

    enum CodingKeys: String, CodingKey {
        case id, email
        case createdAt = "created_at"
        case appMetadata = "app_metadata"
        case userMetadata = "user_metadata"
    }
}

struct AuthSession: Codable, Equatable {
    let accessToken: String
    let refreshToken: String
    let expiresIn: Int?
    let expiresAt: TimeInterval?
    let tokenType: String?
    let user: AuthUser
}

// MARK: - Flexible JSON

enum JSONAny: Codable, Equatable, Hashable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([JSONAny])
    case object([String: JSONAny])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONAny].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONAny].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var boolValue: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    var intValue: Int? {
        if case .int(let value) = self { return value }
        if case .double(let value) = self { return Int(value) }
        return nil
    }

    subscript(key: String) -> JSONAny? {
        if case .object(let dict) = self { return dict[key] }
        return nil
    }
}

// MARK: - Auth errors

struct SupabaseAuthError: LocalizedError {
    let message: String
    let code: String?
    var errorDescription: String? { message }
}

// MARK: - MFA types

struct MFAFactor: Codable, Identifiable, Equatable {
    let id: String
    let factorType: String?
    let status: String?
    let friendlyName: String?

    enum CodingKeys: String, CodingKey {
        case id
        case factorType = "factor_type"
        case status
        case friendlyName = "friendly_name"
    }
}

struct MFAFactorsResponse: Codable {
    let all: [MFAFactor]?
    let totp: [MFAFactor]?
}

struct MFAEnrollResponse: Codable {
    let id: String
    let totp: MFAEnrollTOTP?

    struct MFAEnrollTOTP: Codable {
        let qrCode: String?
        let secret: String?
        let uri: String?

        enum CodingKeys: String, CodingKey {
            case qrCode = "qr_code"
            case secret
            case uri
        }
    }
}

struct MFAChallengeResponse: Codable {
    let id: String
}

struct AuthenticatorAssuranceLevel: Equatable {
    let currentLevel: String?
    let nextLevel: String?
}

// MARK: - Keychain token store

private enum TokenKeychain {
    private static let service = "TravelHandbook.SupabaseSession"
    private static let accessAccount = "access_token"
    private static let refreshAccount = "refresh_token"

    static func save(accessToken: String?, refreshToken: String?) {
        write(accessToken, account: accessAccount)
        write(refreshToken, account: refreshAccount)
        if accessToken == nil {
            UserDefaults.standard.removeObject(forKey: "supabase-session-expires-at")
        }
    }

    static func loadAccessToken() -> String? { read(account: accessAccount) }
    static func loadRefreshToken() -> String? { read(account: refreshAccount) }

    static func clear() {
        save(accessToken: nil, refreshToken: nil)
    }

    private static func write(_ value: String?, account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value else { return }
        var add = query
        add[kSecValueData as String] = value.data(using: .utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private static func read(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - PostgREST builder

struct PostgrestResponse {
    let data: Data
    let statusCode: Int
    let contentRange: String?

    var totalCount: Int? {
        guard let contentRange else { return nil }
        guard let totalPart = contentRange.split(separator: "/").last else { return nil }
        if totalPart == "*" { return nil }
        return Int(totalPart)
    }
}

final class PostgrestQueryBuilder {
    private let client: SupabaseClient
    private let table: String
    private var method: String = "GET"
    private var queryItems: [URLQueryItem] = []
    private var body: Data?
    private var extraHeaders: [String: String] = [:]
    private var preferRepresentation = false

    init(client: SupabaseClient, table: String) {
        self.client = client
        self.table = table
    }

    func select(_ columns: String = "*") -> PostgrestQueryBuilder {
        method = "GET"
        queryItems.append(URLQueryItem(name: "select", value: columns))
        return self
    }

    func eq(_ column: String, value: String) -> PostgrestQueryBuilder {
        queryItems.append(URLQueryItem(name: column, value: "eq.\(value)"))
        return self
    }

    func order(_ column: String, ascending: Bool = true) -> PostgrestQueryBuilder {
        queryItems.append(URLQueryItem(name: "order", value: "\(column).\(ascending ? "asc" : "desc")"))
        return self
    }

    func upsert(_ rows: [[String: JSONAny]], onConflict: String? = nil) -> PostgrestQueryBuilder {
        method = "POST"
        preferRepresentation = true
        extraHeaders["Prefer"] = "resolution=merge-duplicates,return=representation"
        if let onConflict {
            queryItems.append(URLQueryItem(name: "on_conflict", value: onConflict))
        }
        body = try? JSONEncoder.supabase.encode(rows)
        return self
    }

    func upsert(_ row: [String: JSONAny], onConflict: String? = nil) -> PostgrestQueryBuilder {
        upsert([row], onConflict: onConflict)
    }

    func delete() -> PostgrestQueryBuilder {
        method = "DELETE"
        return self
    }

    func range(from: Int, to: Int) -> PostgrestQueryBuilder {
        extraHeaders["Range-Unit"] = "items"
        extraHeaders["Range"] = "\(from)-\(to)"
        return self
    }

    func preferCountExact() -> PostgrestQueryBuilder {
        if let existing = extraHeaders["Prefer"], !existing.isEmpty {
            extraHeaders["Prefer"] = "\(existing),count=exact"
        } else {
            extraHeaders["Prefer"] = "count=exact"
        }
        return self
    }

    func maybeSingle() async throws -> [String: JSONAny]? {
        extraHeaders["Accept"] = "application/vnd.pgrst.object+json"
        let response = try await execute()
        guard response.statusCode != 406, !response.data.isEmpty else { return nil }
        return try JSONDecoder.supabase.decode([String: JSONAny].self, from: response.data)
    }

    func execute() async throws -> PostgrestResponse {
        try await client.executePostgrest(
            table: table,
            method: method,
            queryItems: queryItems,
            body: body,
            extraHeaders: extraHeaders
        )
    }

    func decodeRows<T: Decodable>(_ type: T.Type) async throws -> T {
        let response = try await execute()
        return try JSONDecoder.supabase.decode(T.self, from: response.data)
    }

    func decodeRowsWithCount<T: Decodable>(_ type: T.Type) async throws -> (T, Int?) {
        let response = try await execute()
        let decoded = try JSONDecoder.supabase.decode(T.self, from: response.data)
        return (decoded, response.totalCount)
    }
}

// MARK: - Supabase client

final class SupabaseClient: @unchecked Sendable {
    static let shared = SupabaseClient()

    private let session: URLSession
    private var inMemoryAccessToken: String?
    private var inMemoryRefreshToken: String?

    private init(session: URLSession = .shared) {
        self.session = session
    }

    var isConfigured: Bool { SupabaseConfig.isConfigured }

    // MARK: Auth — sign up / sign in

    func signUp(email: String, password: String) async throws -> AuthSession? {
        let body: [String: Any] = ["email": email, "password": password]
        let data = try await authRequest(path: "signup", method: "POST", json: body)
        return try parseAuthSession(from: data)
    }

    func signIn(email: String, password: String) async throws -> AuthSession {
        let body: [String: Any] = ["email": email, "password": password]
        let data = try await authRequest(
            path: "token",
            method: "POST",
            query: [URLQueryItem(name: "grant_type", value: "password")],
            json: body
        )
        guard let session = try parseAuthSession(from: data) else {
            throw SupabaseAuthError(message: "Sign in did not return a session.", code: nil)
        }
        persist(session: session)
        return session
    }

    func signOut() async throws {
        _ = try? await authRequest(path: "logout", method: "POST", authorized: true)
        clearPersistedSession()
    }

    func getSession() async throws -> AuthSession? {
        if let memory = inMemorySession() { return memory }
        guard let access = TokenKeychain.loadAccessToken() else { return nil }
        inMemoryAccessToken = access
        inMemoryRefreshToken = TokenKeychain.loadRefreshToken()

        if isAccessTokenExpired(access), let refresh = inMemoryRefreshToken {
            return try await refreshSession(refreshToken: refresh)
        }

        let data = try await authRequest(path: "user", method: "GET", authorized: true)
        let user = try JSONDecoder.supabaseAuth.decode(AuthUser.self, from: data)
        return AuthSession(
            accessToken: access,
            refreshToken: inMemoryRefreshToken ?? "",
            expiresIn: nil,
            expiresAt: expiresAtFromToken(access),
            tokenType: "bearer",
            user: user
        )
    }

    func resetPasswordForEmail(_ email: String, redirectTo: String? = nil) async throws {
        var body: [String: Any] = ["email": email]
        if let redirectTo { body["redirect_to"] = redirectTo }
        _ = try await authRequest(path: "recover", method: "POST", json: body)
    }

    func updateUser(attributes: [String: Any]) async throws -> AuthUser {
        let data = try await authRequest(path: "user", method: "PUT", json: attributes, authorized: true)
        let user = try JSONDecoder.supabaseAuth.decode(AuthUser.self, from: data)
        return user
    }

    // MARK: MFA

    func mfaEnroll(friendlyName: String) async throws -> MFAEnrollResponse {
        let body: [String: Any] = [
            "factor_type": "totp",
            "friendly_name": friendlyName,
        ]
        let data = try await authRequest(path: "factors", method: "POST", json: body, authorized: true)
        return try JSONDecoder.supabaseAuth.decode(MFAEnrollResponse.self, from: data)
    }

    func mfaChallenge(factorId: String) async throws -> MFAChallengeResponse {
        let data = try await authRequest(
            path: "factors/\(factorId)/challenge",
            method: "POST",
            authorized: true
        )
        return try JSONDecoder.supabaseAuth.decode(MFAChallengeResponse.self, from: data)
    }

    func mfaVerify(factorId: String, challengeId: String, code: String) async throws -> AuthSession? {
        let body: [String: Any] = [
            "challenge_id": challengeId,
            "code": code,
        ]
        let data = try await authRequest(
            path: "factors/\(factorId)/verify",
            method: "POST",
            json: body,
            authorized: true
        )
        if let session = try parseAuthSession(from: data) {
            persist(session: session)
            return session
        }
        return nil
    }

    func mfaUnenroll(factorId: String) async throws {
        _ = try await authRequest(path: "factors/\(factorId)", method: "DELETE", authorized: true)
    }

    func listFactors() async throws -> MFAFactorsResponse {
        let data = try await authRequest(path: "factors", method: "GET", authorized: true)
        return try JSONDecoder.supabaseAuth.decode(MFAFactorsResponse.self, from: data)
    }

    func getAuthenticatorAssuranceLevel(accessToken: String? = nil, verifiedFactorCount: Int = 0) -> AuthenticatorAssuranceLevel {
        let token = accessToken ?? currentAccessToken()
        var current = token.flatMap { decodeJWTPayload($0)?["aal"]?.stringValue }
        var next = current

        if verifiedFactorCount > 0 {
            if current == nil || current == "aal1" {
                current = current ?? "aal1"
                next = "aal2"
            } else if current == "aal2" {
                next = "aal2"
            }
        } else {
            current = current ?? "aal1"
            next = next ?? "aal1"
        }

        return AuthenticatorAssuranceLevel(currentLevel: current, nextLevel: next)
    }

    func mfaStatus(accessToken: String? = nil) async throws -> MfaStatusSnapshot {
        let token = accessToken ?? currentAccessToken()
        let factors = try await listFactors()
        let verified = factors.totp ?? []
        let unverified = (factors.all ?? []).filter {
            ($0.factorType ?? "totp") == "totp" && $0.status != "verified"
        }
        let aal = getAuthenticatorAssuranceLevel(accessToken: token, verifiedFactorCount: verified.count)
        let needsChallenge = aal.currentLevel == "aal1" && aal.nextLevel == "aal2"
        return MfaStatusSnapshot(
            currentLevel: aal.currentLevel,
            nextLevel: aal.nextLevel,
            verifiedFactors: verified,
            unverifiedFactors: unverified,
            needsChallenge: needsChallenge,
            isEnabled: !verified.isEmpty
        )
    }

    // MARK: PostgREST

    func from(_ table: String) -> PostgrestQueryBuilder {
        PostgrestQueryBuilder(client: self, table: table)
    }

    func executePostgrest(
        table: String,
        method: String,
        queryItems: [URLQueryItem],
        body: Data?,
        extraHeaders: [String: String]
    ) async throws -> PostgrestResponse {
        guard isConfigured else {
            throw SupabaseAuthError(message: "Supabase is not configured.", code: nil)
        }
        var components = URLComponents(url: supabaseURL("rest", "v1", table), resolvingAgainstBaseURL: false)!
        if !queryItems.isEmpty { components.queryItems = queryItems }
        guard let url = components.url else {
            throw SupabaseAuthError(message: "Invalid PostgREST URL.", code: nil)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        applyAnonHeaders(&request)
        if let token = currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        for (key, value) in extraHeaders {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        let (data, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 400 {
            throw parseAuthError(from: data) ?? SupabaseAuthError(message: "PostgREST request failed (\(code)).", code: nil)
        }
        let contentRange = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Range")
        return PostgrestResponse(data: data, statusCode: code, contentRange: contentRange)
    }

    // MARK: Storage

    func uploadObject(bucket: String, path: String, data: Data, contentType: String, upsert: Bool = true) async throws {
        guard isConfigured else { return }
        let url = supabaseURL("storage", "v1", "object", bucket, path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        if upsert {
            request.setValue("true", forHTTPHeaderField: "x-upsert")
        }
        applyAnonHeaders(&request)
        if let token = currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (responseData, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 400 {
            throw parseAuthError(from: responseData) ?? SupabaseAuthError(message: "Storage upload failed (\(code)).", code: nil)
        }
    }

    func downloadObject(bucket: String, path: String) async throws -> Data {
        let url = supabaseURL("storage", "v1", "object", bucket, path)
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        applyAnonHeaders(&request)
        if let token = currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 400 {
            throw SupabaseAuthError(message: "Storage download failed (\(code)).", code: nil)
        }
        return data
    }

    func publicObjectURL(bucket: String, path: String) -> URL {
        supabaseURL("storage", "v1", "object", "public", bucket, path)
    }

    func createSignedURL(bucket: String, path: String, expiresIn seconds: Int = 3600) async throws -> URL {
        let url = supabaseURL("storage", "v1", "object", "sign", bucket, path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try JSONSerialization.data(withJSONObject: ["expiresIn": seconds])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAnonHeaders(&request)
        if let token = currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 400 {
            throw SupabaseAuthError(message: "Signed URL request failed (\(code)).", code: nil)
        }
        struct SignedPayload: Decodable {
            let signedURL: String?
            enum CodingKeys: String, CodingKey {
                case signedURL = "signedURL"
            }
        }
        let payload = try JSONDecoder.supabase.decode(SignedPayload.self, from: data)
        guard let signed = payload.signedURL else {
            throw SupabaseAuthError(message: "Signed URL missing from response.", code: nil)
        }
        if signed.hasPrefix("http") {
            guard let absolute = URL(string: signed) else {
                throw SupabaseAuthError(message: "Invalid signed URL.", code: nil)
            }
            return absolute
        }
        let base = SupabaseConfig.url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let suffix = signed.hasPrefix("/") ? signed : "/\(signed)"
        guard let absolute = URL(string: base + suffix) else {
            throw SupabaseAuthError(message: "Invalid signed URL.", code: nil)
        }
        return absolute
    }

    func removeObjects(bucket: String, paths: [String]) async throws {
        let url = supabaseURL("storage", "v1", "object", bucket)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.httpBody = try JSONSerialization.data(withJSONObject: ["prefixes": paths])
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        applyAnonHeaders(&request)
        if let token = currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        _ = try await session.data(for: request)
    }

    // MARK: Session helpers

    func persist(session: AuthSession) {
        inMemoryAccessToken = session.accessToken
        inMemoryRefreshToken = session.refreshToken
        TokenKeychain.save(accessToken: session.accessToken, refreshToken: session.refreshToken)
        if let expiresAt = session.expiresAt {
            UserDefaults.standard.set(expiresAt, forKey: "supabase-session-expires-at")
        }
    }

    func clearPersistedSession() {
        inMemoryAccessToken = nil
        inMemoryRefreshToken = nil
        TokenKeychain.clear()
    }

    func currentAccessToken() -> String? {
        inMemoryAccessToken ?? TokenKeychain.loadAccessToken()
    }

    // MARK: Private

    private func inMemorySession() -> AuthSession? {
        guard let access = inMemoryAccessToken, let refresh = inMemoryRefreshToken else { return nil }
        return AuthSession(
            accessToken: access,
            refreshToken: refresh,
            expiresIn: nil,
            expiresAt: expiresAtFromToken(access),
            tokenType: "bearer",
            user: AuthUser(id: "", email: nil, createdAt: nil, appMetadata: nil, userMetadata: nil)
        )
    }

    private func refreshSession(refreshToken: String) async throws -> AuthSession? {
        let data = try await authRequest(
            path: "token",
            method: "POST",
            query: [URLQueryItem(name: "grant_type", value: "refresh_token")],
            json: ["refresh_token": refreshToken]
        )
        guard let session = try parseAuthSession(from: data) else { return nil }
        persist(session: session)
        return session
    }

    private func authRequest(
        path: String,
        method: String,
        query: [URLQueryItem] = [],
        json: [String: Any]? = nil,
        authorized: Bool = false
    ) async throws -> Data {
        guard isConfigured else {
            throw SupabaseAuthError(message: "Supabase is not configured.", code: nil)
        }
        var components = URLComponents(
            url: supabaseURL("auth", "v1", path),
            resolvingAgainstBaseURL: false
        )!
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else {
            throw SupabaseAuthError(message: "Invalid auth URL.", code: nil)
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        if let json {
            request.httpBody = try JSONSerialization.data(withJSONObject: json)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        applyAnonHeaders(&request)
        if authorized, let token = currentAccessToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let (data, response) = try await session.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code >= 400 {
            throw parseAuthError(from: data) ?? SupabaseAuthError(message: "Auth request failed (\(code)).", code: nil)
        }
        return data
    }

    private func applyAnonHeaders(_ request: inout URLRequest) {
        request.setValue(SupabaseConfig.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(SupabaseConfig.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
    }

    /// Builds `base/seg1/seg2/...` without percent-encoding `/` (unlike `appendingPathComponent("a/b")`).
    private func supabaseURL(_ pathComponents: String...) -> URL {
        var url = SupabaseConfig.url
        for component in pathComponents {
            for part in component.split(separator: "/") where !part.isEmpty {
                url = url.appendingPathComponent(String(part))
            }
        }
        return url
    }

    private func parseAuthSession(from data: Data) throws -> AuthSession? {
        struct AuthPayload: Decodable {
            let accessToken: String?
            let refreshToken: String?
            let expiresIn: Int?
            let tokenType: String?
            let user: AuthUser?

            enum CodingKeys: String, CodingKey {
                case accessToken = "access_token"
                case refreshToken = "refresh_token"
                case expiresIn = "expires_in"
                case tokenType = "token_type"
                case user
            }
        }
        // Use plain decoder: these models already map snake_case via CodingKeys.
        // `JSONDecoder.supabase` (convertFromSnakeCase) breaks that and drops access_token.
        let payload = try JSONDecoder.supabaseAuth.decode(AuthPayload.self, from: data)
        guard let access = payload.accessToken, let user = payload.user else { return nil }
        let expiresAt = payload.expiresIn.map { Date().timeIntervalSince1970 + Double($0) }
        return AuthSession(
            accessToken: access,
            refreshToken: payload.refreshToken ?? "",
            expiresIn: payload.expiresIn,
            expiresAt: expiresAt,
            tokenType: payload.tokenType,
            user: user
        )
    }

    private func parseAuthError(from data: Data) -> SupabaseAuthError? {
        // Supabase may return `code` as Int (400) or String — avoid snake_case decoder + typed `code: String`
        // which silently fails and leaves users with a generic "Auth request failed (400)".
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            if let raw = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
               !raw.isEmpty {
                return SupabaseAuthError(message: raw, code: nil)
            }
            return nil
        }

        let textCandidates: [String?] = [
            object["msg"] as? String,
            object["message"] as? String,
            object["error_description"] as? String,
            object["error"] as? String,
        ]
        let text = textCandidates.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty } ?? "Request failed."

        let code: String?
        if let stringCode = object["error_code"] as? String {
            code = stringCode
        } else if let stringCode = object["code"] as? String {
            code = stringCode
        } else if let intCode = object["code"] as? Int {
            code = String(intCode)
        } else {
            code = nil
        }

        return SupabaseAuthError(message: text, code: code)
    }

    private func isAccessTokenExpired(_ token: String) -> Bool {
        guard let exp = expiresAtFromToken(token) else { return false }
        return Date().timeIntervalSince1970 >= exp - 60
    }

    private func expiresAtFromToken(_ token: String) -> TimeInterval? {
        decodeJWTPayload(token)?["exp"]?.doubleValue
    }

    private func decodeJWTPayload(_ token: String) -> [String: JSONAny]? {
        let parts = token.split(separator: ".")
        guard parts.count >= 2 else { return nil }
        var base64 = String(parts[1])
        base64 = base64.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64.append("=") }
        guard let data = Data(base64Encoded: base64),
              let json = try? JSONDecoder.supabase.decode([String: JSONAny].self, from: data)
        else { return nil }
        return json
    }
}

struct MfaStatusSnapshot: Equatable {
    let currentLevel: String?
    let nextLevel: String?
    let verifiedFactors: [MFAFactor]
    let unverifiedFactors: [MFAFactor]
    let needsChallenge: Bool
    let isEnabled: Bool
}

private extension JSONAny {
    var arrayValue: [JSONAny]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var doubleValue: TimeInterval? {
        if case .double(let value) = self { return value }
        if case .int(let value) = self { return TimeInterval(value) }
        return nil
    }
}

extension JSONEncoder {
    static let supabase: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }()
}

extension JSONDecoder {
    static let supabase: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    /// Auth models use explicit `CodingKeys` for snake_case — do not also convertFromSnakeCase.
    static let supabaseAuth: JSONDecoder = {
        JSONDecoder()
    }()
}
