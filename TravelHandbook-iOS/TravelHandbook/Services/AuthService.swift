import Foundation

enum AuthConstants {
    static let demoEmail = "demo@travelhandbook.local"
    static let demoPassword = "Demo1234"
    static let rememberMeKey = "travel-handbook-remember-me"
}

struct LocalAuthUser: Codable, Equatable {
    let email: String
    let password: String
}

final class AuthService {
    static let shared = AuthService()

    private let defaults = UserDefaults.standard
    private let supabase = SupabaseClient.shared

    private init() {}

    static func createDemoUser() -> AuthUser {
        AuthUser(
            id: "demo-user",
            email: AuthConstants.demoEmail,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            appMetadata: nil,
            userMetadata: ["demo": .bool(true)]
        )
    }

    static func createLocalTestUser(email: String) -> AuthUser {
        AuthUser(
            id: "local-\(email.lowercased())",
            email: email,
            createdAt: ISO8601DateFormatter().string(from: Date()),
            appMetadata: nil,
            userMetadata: ["localTest": .bool(true)]
        )
    }

    func restoreDemoSession() -> AuthUser? {
        guard LocalStore.getString(key: LocalStore.demoUserKey) == "true" else { return nil }
        return Self.createDemoUser()
    }

    func restoreLocalSession() -> AuthUser? {
        guard let email = LocalStore.getString(key: LocalStore.localAuthSessionKey) else { return nil }
        return Self.createLocalTestUser(email: email)
    }

    func signInDemo() {
        LocalStore.setString("true", key: LocalStore.demoUserKey)
        LocalStore.remove(key: LocalStore.localAuthSessionKey)
    }

    func signInLocal(email: String, password: String) -> Result<AuthUser, String> {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard let matched = readLocalAuthUsers().first(where: {
            $0.email.lowercased() == normalized && $0.password == password
        }) else {
            return .failure("Incorrect email or password.")
        }
        LocalStore.remove(key: LocalStore.demoUserKey)
        LocalStore.setString(matched.email, key: LocalStore.localAuthSessionKey)
        return .success(Self.createLocalTestUser(email: matched.email))
    }

    func signUpLocal(email: String, password: String) -> Result<AuthUser, String> {
        let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        var users = readLocalAuthUsers()
        if users.contains(where: { $0.email.lowercased() == normalized }) {
            return .failure("A local test account with this email already exists. Try signing in instead.")
        }
        users.append(LocalAuthUser(email: normalized, password: password))
        writeLocalAuthUsers(users)
        LocalStore.remove(key: LocalStore.demoUserKey)
        LocalStore.setString(normalized, key: LocalStore.localAuthSessionKey)
        return .success(Self.createLocalTestUser(email: normalized))
    }

    func clearLocalSessions() {
        LocalStore.remove(key: LocalStore.demoUserKey)
        LocalStore.remove(key: LocalStore.localAuthSessionKey)
    }

    func signInCloud(email: String, password: String) async throws -> AuthSession {
        try await supabase.signIn(email: email, password: password)
    }

    func signUpCloud(email: String, password: String) async throws -> AuthSession? {
        let session = try await supabase.signUp(email: email, password: password)
        if let session {
            supabase.persist(session: session)
        }
        return session
    }

    func restoreCloudSession() async throws -> AuthSession? {
        guard supabase.isConfigured else { return nil }
        return try await supabase.getSession()
    }

    func signOutCloud() async {
        try? await supabase.signOut()
        supabase.clearPersistedSession()
    }

    func resetPassword(email: String) async throws {
        let redirect = SupabaseConfig.authRedirectURL?.absoluteString
        try await supabase.resetPasswordForEmail(email, redirectTo: redirect)
    }

    func fetchMfaStatus(accessToken: String? = nil) async throws -> MfaStatusSnapshot {
        try await supabase.mfaStatus(accessToken: accessToken)
    }

    func verifyTotpChallenge(factorId: String, code: String) async throws {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^\d{6}$"#, options: .regularExpression) != nil else {
            throw SupabaseAuthError(message: "Enter the 6-digit code from your authenticator app.", code: nil)
        }
        let challenge = try await supabase.mfaChallenge(factorId: factorId)
        _ = try await supabase.mfaVerify(factorId: factorId, challengeId: challenge.id, code: trimmed)
    }

    func enrollTotp(friendlyName: String) async throws -> MFAEnrollResponse {
        try await supabase.mfaEnroll(friendlyName: friendlyName)
    }

    func verifyEnrollment(factorId: String, code: String) async throws {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: #"^\d{6}$"#, options: .regularExpression) != nil else {
            throw SupabaseAuthError(message: "Enter the 6-digit code from your authenticator app.", code: nil)
        }
        let challenge = try await supabase.mfaChallenge(factorId: factorId)
        _ = try await supabase.mfaVerify(factorId: factorId, challengeId: challenge.id, code: trimmed)
    }

    func changePassword(
        email: String?,
        currentPassword: String,
        newPassword: String,
        isLocalTestUser: Bool,
        isDemoUser: Bool
    ) async throws {
        if isDemoUser {
            throw SupabaseAuthError(message: "Demo mode uses a fixed password and cannot be changed.", code: nil)
        }

        let trimmedCurrent = currentPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNew = newPassword.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedCurrent.isEmpty else {
            throw SupabaseAuthError(message: "Enter your current password first.", code: nil)
        }
        guard trimmedNew.count >= 8,
              trimmedNew.range(of: "[A-Z]", options: .regularExpression) != nil,
              trimmedNew.range(of: "[0-9]", options: .regularExpression) != nil else {
            throw SupabaseAuthError(message: "New password must be at least 8 characters long and contain a number and an uppercase letter.", code: nil)
        }

        if isLocalTestUser {
            guard let email else {
                throw SupabaseAuthError(message: "Missing local account email.", code: nil)
            }
            let normalized = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            var users = readLocalAuthUsers()
            guard let index = users.firstIndex(where: { $0.email.lowercased() == normalized }) else {
                throw SupabaseAuthError(message: "Local account not found on this device.", code: nil)
            }
            guard users[index].password == trimmedCurrent else {
                throw SupabaseAuthError(message: "Current password is incorrect.", code: nil)
            }
            users[index] = LocalAuthUser(email: users[index].email, password: trimmedNew)
            writeLocalAuthUsers(users)
            return
        }

        guard let email else {
            throw SupabaseAuthError(message: "Missing account email.", code: nil)
        }

        _ = try await signInCloud(email: email, password: trimmedCurrent)
        _ = try await supabase.updateUser(attributes: ["password": trimmedNew])
    }

    func disableTotp(factorId: String, code: String) async throws {
        try await verifyTotpChallenge(factorId: factorId, code: code)
        try await supabase.mfaUnenroll(factorId: factorId)
    }

    func cleanupUnverifiedFactors(_ factors: [MFAFactor]) async {
        for factor in factors {
            try? await supabase.mfaUnenroll(factorId: factor.id)
        }
    }

    var rememberMe: Bool {
        get {
            if defaults.object(forKey: AuthConstants.rememberMeKey) == nil { return true }
            return defaults.bool(forKey: AuthConstants.rememberMeKey)
        }
        set { defaults.set(newValue, forKey: AuthConstants.rememberMeKey) }
    }

    private func readLocalAuthUsers() -> [LocalAuthUser] {
        LocalStore.getJSON([LocalAuthUser].self, key: LocalStore.localAuthUsersKey) ?? []
    }

    private func writeLocalAuthUsers(_ users: [LocalAuthUser]) {
        LocalStore.setJSON(users, key: LocalStore.localAuthUsersKey)
    }
}
