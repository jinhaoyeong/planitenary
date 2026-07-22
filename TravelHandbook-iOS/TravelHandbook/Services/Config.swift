import Foundation

enum SupabaseConfig {
    private static let urlInfoKey = "SUPABASE_URL"
    private static let anonKeyInfoKey = "SUPABASE_ANON_KEY"
    private static let redirectInfoKey = "SUPABASE_AUTH_REDIRECT_URL"

    private static let fallbackURL = "https://placeholder-project.supabase.co"
    private static let fallbackAnonKey = "placeholder-anon-key"

    static var url: URL {
        if let configured = normalizedURL(from: infoString(urlInfoKey)) {
            return configured
        }
        return URL(string: fallbackURL)!
    }

    static var anonKey: String {
        let trimmed = infoString(anonKeyInfoKey)?.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
        guard let trimmed, !trimmed.isEmpty else { return fallbackAnonKey }
        return trimmed
    }

    static var isConfigured: Bool {
        guard let url = normalizedURL(from: infoString(urlInfoKey)),
              let host = url.host?.lowercased(),
              !host.isEmpty,
              !host.contains("your-project"),
              !host.contains("placeholder") else {
            return false
        }

        let key = infoString(anonKeyInfoKey)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "'\"")) ?? ""
        guard !key.isEmpty,
              !key.localizedCaseInsensitiveContains("your-public"),
              !key.localizedCaseInsensitiveContains("placeholder") else {
            return false
        }
        return true
    }

    static var authRedirectURL: URL? {
        resolveRedirectURL(infoString(redirectInfoKey))
    }

    private static func infoString(_ key: String) -> String? {
        Bundle.main.object(forInfoDictionaryKey: key) as? String
    }

    private static func normalizedURL(from raw: String?) -> URL? {
        guard var trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "'\"")),
              !trimmed.isEmpty else {
            return nil
        }

        if let url = URL(string: trimmed), let host = url.host, !host.isEmpty {
            var components = URLComponents()
            components.scheme = url.scheme ?? "https"
            components.host = host
            components.port = url.port
            return components.url
        }

        trimmed = trimmed
            .replacingOccurrences(of: "/auth/v1", with: "", options: .caseInsensitive)
            .replacingOccurrences(of: "/rest/v1", with: "", options: .caseInsensitive)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))

        if trimmed.hasPrefix("http://") || trimmed.hasPrefix("https://") {
            return URL(string: trimmed)
        }

        return URL(string: "https://\(trimmed)")
    }

    private static func resolveRedirectURL(_ raw: String?) -> URL? {
        guard var sanitized = raw?.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "'\"")),
              !sanitized.isEmpty else {
            return URL(string: "travelhandbook://auth-callback")
        }

        if sanitized.lowercased().hasPrefix("http://") || sanitized.lowercased().hasPrefix("https://") {
            return URL(string: sanitized)
        }

        if sanitized.contains(".") {
            if !sanitized.lowercased().hasPrefix("https://") {
                sanitized = "https://\(sanitized)"
            }
            return URL(string: sanitized)
        }

        return URL(string: sanitized)
    }
}
