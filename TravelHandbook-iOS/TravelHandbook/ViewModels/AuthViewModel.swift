import Foundation
import Combine

@MainActor
final class AuthViewModel: ObservableObject {
    @Published private(set) var session: AuthSession?
    @Published private(set) var user: AuthUser?
    @Published private(set) var isLoading = true
    @Published private(set) var isDemoUser = false
    @Published private(set) var isLocalTestUser = false
    @Published private(set) var needsMfaVerification = false
    @Published private(set) var mfaStatusReady = false
    @Published private(set) var mfaEnabled = false
    @Published private(set) var mfaFactorId: String?

    private let authService = AuthService.shared

    init() {
        Task { await bootstrap() }
    }

    func bootstrap() async {
        isLoading = true
        defer {
            isLoading = false
        }

        if let demoUser = authService.restoreDemoSession() {
            applyDemoUser(demoUser)
            return
        }

        if let localUser = authService.restoreLocalSession() {
            applyLocalUser(localUser)
            return
        }

        guard SupabaseClient.shared.isConfigured else {
            mfaStatusReady = true
            return
        }

        do {
            if let cloudSession = try await authService.restoreCloudSession() {
                applyCloudSession(cloudSession)
                await applyMfaStatus(for: cloudSession)
            } else {
                mfaStatusReady = true
            }
        } catch {
            mfaStatusReady = true
        }
    }

    func signIn(email: String, password: String) async -> Result<Void, AuthFailure> {
        let normalizedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalizedEmail == AuthConstants.demoEmail, password == AuthConstants.demoPassword {
            signInDemo()
            return .success(())
        }

        switch authService.signInLocal(email: email, password: password) {
        case .success(let localUser):
            applyLocalUser(localUser)
            return .success(())
        case .failure:
            break
        }

        guard SupabaseClient.shared.isConfigured else {
            return .failure(AuthFailure(
                "Authentication is not configured yet. Add your Supabase environment variables to enable cloud sign in, or use a local test account created on this device."
            ))
        }

        do {
            let cloudSession = try await authService.signInCloud(email: email, password: password)
            applyCloudSession(cloudSession)
            await applyMfaStatus(for: cloudSession)
            return .success(())
        } catch let error as SupabaseAuthError {
            return .failure(AuthFailure(Self.mapAuthError(error)))
        } catch {
            return .failure(AuthFailure(error.localizedDescription))
        }
    }

    func signUp(email: String, password: String) async -> Result<String?, AuthFailure> {
        guard Self.isStrongPassword(password) else {
            return .failure(AuthFailure("Password must be at least 8 characters long and contain a number and an uppercase letter."))
        }

        if SupabaseClient.shared.isConfigured {
            do {
                let session = try await authService.signUpCloud(email: email, password: password)
                if let session {
                    applyCloudSession(session)
                    await applyMfaStatus(for: session)
                    return .success(nil)
                }
                return .success("Registration successful! Please check your email to verify your account before signing in.")
            } catch let error as SupabaseAuthError {
                return .failure(AuthFailure(Self.mapAuthError(error)))
            } catch {
                return .failure(AuthFailure(error.localizedDescription))
            }
        }

        switch authService.signUpLocal(email: email, password: password) {
        case .success(let localUser):
            applyLocalUser(localUser)
            return .success(nil)
        case .failure(let failure):
            return .failure(failure)
        }
    }

    func signInDemo() {
        authService.signInDemo()
        applyDemoUser(AuthService.createDemoUser())
    }

    func signInLocal(email: String, password: String) -> Result<Void, AuthFailure> {
        switch authService.signInLocal(email: email, password: password) {
        case .success(let localUser):
            applyLocalUser(localUser)
            return .success(())
        case .failure(let failure):
            return .failure(failure)
        }
    }

    func signUpLocal(email: String, password: String) -> Result<Void, AuthFailure> {
        switch authService.signUpLocal(email: email, password: password) {
        case .success(let localUser):
            applyLocalUser(localUser)
            return .success(())
        case .failure(let failure):
            return .failure(failure)
        }
    }

    func completeMfaChallenge(code: String) async -> Result<Void, AuthFailure> {
        guard let factorId = mfaFactorId else {
            return .failure(AuthFailure("No authenticator is enrolled on this account."))
        }
        do {
            try await authService.verifyTotpChallenge(factorId: factorId, code: code)
            needsMfaVerification = false
            if let refreshed = try await authService.restoreCloudSession() {
                session = refreshed
                user = refreshed.user
            }
            await refreshMfaStatus()
            return .success(())
        } catch let error as SupabaseAuthError {
            return .failure(AuthFailure(error.message))
        } catch {
            return .failure(AuthFailure(error.localizedDescription))
        }
    }

    func refreshMfaStatus() async {
        await applyMfaStatus(for: session)
    }

    func signOut() async {
        authService.clearLocalSessions()
        session = nil
        user = nil
        isDemoUser = false
        isLocalTestUser = false
        needsMfaVerification = false
        mfaEnabled = false
        mfaFactorId = nil
        mfaStatusReady = false
        await authService.signOutCloud()
        mfaStatusReady = true
    }

    func resetPassword(email: String) async -> Result<Void, AuthFailure> {
        guard SupabaseClient.shared.isConfigured else {
            return .failure(AuthFailure("Password recovery requires a configured cloud account."))
        }
        do {
            try await authService.resetPassword(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
            return .success(())
        } catch let error as SupabaseAuthError {
            return .failure(AuthFailure(Self.mapAuthError(error)))
        } catch {
            return .failure(AuthFailure(error.localizedDescription))
        }
    }

    var rememberMe: Bool {
        get { authService.rememberMe }
        set { authService.rememberMe = newValue }
    }

    var skipsCloudGates: Bool {
        isDemoUser || isLocalTestUser
    }

    // MARK: - Private

    private func applyDemoUser(_ demoUser: AuthUser) {
        session = nil
        user = demoUser
        isDemoUser = true
        isLocalTestUser = false
        needsMfaVerification = false
        mfaEnabled = false
        mfaFactorId = nil
        mfaStatusReady = true
    }

    private func applyLocalUser(_ localUser: AuthUser) {
        session = nil
        user = localUser
        isDemoUser = false
        isLocalTestUser = true
        needsMfaVerification = false
        mfaEnabled = false
        mfaFactorId = nil
        mfaStatusReady = true
    }

    private func applyCloudSession(_ cloudSession: AuthSession) {
        session = cloudSession
        user = cloudSession.user
        isDemoUser = false
        isLocalTestUser = false
    }

    private func applyMfaStatus(for activeSession: AuthSession?) async {
        guard let activeSession, SupabaseClient.shared.isConfigured, !isDemoUser, !isLocalTestUser else {
            needsMfaVerification = false
            mfaEnabled = false
            mfaFactorId = nil
            mfaStatusReady = true
            return
        }

        do {
            let status = try await authService.fetchMfaStatus(accessToken: activeSession.accessToken)
            needsMfaVerification = status.needsChallenge
            mfaEnabled = status.isEnabled
            mfaFactorId = status.verifiedFactors.first?.id
        } catch {
            needsMfaVerification = false
            mfaEnabled = false
            mfaFactorId = nil
        }
        mfaStatusReady = true
    }

    private static func isStrongPassword(_ password: String) -> Bool {
        password.count >= 8 &&
            password.range(of: "[A-Z]", options: .regularExpression) != nil &&
            password.range(of: "[0-9]", options: .regularExpression) != nil
    }

    private static func mapAuthError(_ error: SupabaseAuthError) -> String {
        let message = error.message
        let code = error.code ?? ""
        if message.localizedCaseInsensitiveContains("failed to fetch") {
            return "Connection failed. Check your network and Supabase configuration, then try again."
        }
        if code == "over_email_send_rate_limit" || message.localizedCaseInsensitiveContains("rate limit") {
            return "Too many signup emails were requested. Wait a few minutes, or use a different email while testing."
        }
        if code == "email_not_confirmed" || message.localizedCaseInsensitiveContains("email not confirmed") {
            return "This account exists, but the email has not been confirmed yet. Open the verification email first."
        }
        if code == "invalid_credentials"
            || message.localizedCaseInsensitiveContains("invalid login credentials")
            || message.localizedCaseInsensitiveContains("invalid_credentials") {
            return "Incorrect email or password. If you just signed up, verify the email before signing in."
        }
        return message
    }
}
