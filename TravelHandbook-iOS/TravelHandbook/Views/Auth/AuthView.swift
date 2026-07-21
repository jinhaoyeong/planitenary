import SwiftUI

struct AuthView: View {
    @ObservedObject var auth: AuthViewModel

    @State private var email = ""
    @State private var password = ""
    @State private var mfaCode = ""
    @State private var isLogin = true
    @State private var errorMessage: String?
    @State private var infoMessage: String?
    @State private var isSubmitting = false
    @State private var showPassword = false
    @State private var rememberMe = true

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                header
                if auth.needsMfaVerification {
                    mfaForm
                } else {
                    authForm
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 24)
        }
        .background(EmberRoseTheme.paperBackground.ignoresSafeArea())
        .onAppear {
            rememberMe = auth.rememberMe
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Image(systemName: "airplane")
                .font(.title)
                .foregroundStyle(EmberRoseTheme.accent)
                .frame(width: 64, height: 64)
                .background(EmberRoseTheme.accentSoft, in: Circle())

            HStack(spacing: 4) {
                Text("Travel")
                Text("Handbook")
                    .italic()
                    .foregroundStyle(EmberRoseTheme.accent)
            }
            .font(.system(.largeTitle, design: .serif))

            Group {
                if auth.needsMfaVerification {
                    Text("Enter the 6-digit code from your authenticator app.")
                } else if isLogin {
                    Text("Welcome back. Sign in to your trips.")
                } else {
                    Text("Create an account to start planning.")
                }
            }
            .font(.subheadline)
            .foregroundStyle(EmberRoseTheme.inkMuted)
            .multilineTextAlignment(.center)
        }
        .padding(.bottom, 24)
    }

    private var authForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !SupabaseConfig.isConfigured {
                banner(
                    text: "Cloud auth needs Supabase URL and anon key, but local test sign up still works on this device.",
                    style: .warning
                )
            }

            if let errorMessage {
                banner(text: errorMessage, style: .error)
            }
            if let infoMessage {
                banner(text: infoMessage, style: .info)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Email address")
                    .font(.subheadline.weight(.bold))
                HStack {
                    Image(systemName: "envelope")
                        .foregroundStyle(EmberRoseTheme.inkMuted)
                    TextField("you@example.com", text: $email)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                .padding(14)
                .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(EmberRoseTheme.border))
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Password")
                    .font(.subheadline.weight(.bold))
                HStack {
                    Image(systemName: "lock")
                        .foregroundStyle(EmberRoseTheme.inkMuted)
                    Group {
                        if showPassword {
                            TextField(isLogin ? "Password" : "Min. 8 chars, 1 uppercase, 1 number", text: $password)
                        } else {
                            SecureField(isLogin ? "Password" : "Min. 8 chars, 1 uppercase, 1 number", text: $password)
                        }
                    }
                    .textContentType(isLogin ? .password : .newPassword)
                    Button {
                        showPassword.toggle()
                        Haptics.selectionChanged()
                    } label: {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                            .foregroundStyle(EmberRoseTheme.inkMuted)
                    }
                }
                .padding(14)
                .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(EmberRoseTheme.border))

                if !isLogin, !password.isEmpty, !isStrongPassword(password) {
                    Text("Password must be 8+ chars with at least 1 uppercase and 1 number.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                }
            }

            if isLogin {
                HStack {
                    Toggle(isOn: $rememberMe) {
                        Text("Remember me")
                            .font(.subheadline)
                            .foregroundStyle(EmberRoseTheme.inkMuted)
                    }
                    .toggleStyle(.checkbox)
                    .onChange(of: rememberMe) { _, newValue in
                        auth.rememberMe = newValue
                    }
                    Spacer()
                    Button("Forgot password?") {
                        Task { await handleForgotPassword() }
                    }
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(EmberRoseTheme.accent)
                }
            }

            Button {
                Task { await handleSubmit() }
            } label: {
                Text(isSubmitting ? "Please wait…" : (isLogin ? "Sign In" : "Create Account"))
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillButtonStyle(variant: .primary))
            .disabled(isSubmitting || (!isLogin && !isStrongPassword(password)))

            Button("Enter Demo Mode") {
                email = AuthConstants.demoEmail
                password = AuthConstants.demoPassword
                errorMessage = nil
                Haptics.mediumImpact()
                auth.signInDemo()
            }
            .buttonStyle(PillButtonStyle(variant: .soft))
            .frame(maxWidth: .infinity)

            Text("Test login: \(AuthConstants.demoEmail) / \(AuthConstants.demoPassword)")
                .font(.caption)
                .foregroundStyle(EmberRoseTheme.inkMuted)
                .frame(maxWidth: .infinity, alignment: .center)

            if !isLogin {
                Text("If Supabase email is rate-limited, the app will create a local test account with these same credentials.")
                    .font(.caption)
                    .foregroundStyle(EmberRoseTheme.inkMuted)
            }

            HStack {
                Spacer()
                Text(isLogin ? "Don't have an account?" : "Already have an account?")
                    .foregroundStyle(EmberRoseTheme.inkMuted)
                Button(isLogin ? "Sign up" : "Sign in") {
                    isLogin.toggle()
                    errorMessage = nil
                    infoMessage = nil
                    Haptics.selectionChanged()
                }
                .fontWeight(.bold)
                .foregroundStyle(EmberRoseTheme.accent)
                Spacer()
            }
            .font(.subheadline)
            .padding(.top, 8)
        }
        .padding(20)
        .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28).stroke(EmberRoseTheme.border))
    }

    private var mfaForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let errorMessage {
                banner(text: errorMessage, style: .error)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Authenticator code")
                    .font(.subheadline.weight(.bold))
                HStack {
                    Image(systemName: "lock")
                        .foregroundStyle(EmberRoseTheme.inkMuted)
                    TextField("000000", text: $mfaCode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .multilineTextAlignment(.center)
                        .font(.title3.weight(.semibold))
                        .tracking(6)
                        .onChange(of: mfaCode) { _, newValue in
                            mfaCode = String(newValue.filter(\.isNumber).prefix(6))
                        }
                }
                .padding(14)
                .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(EmberRoseTheme.border))
            }

            Button {
                Task { await handleMfaSubmit() }
            } label: {
                Text(isSubmitting ? "Verifying…" : "Verify and continue")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillButtonStyle(variant: .primary))
            .disabled(isSubmitting || mfaCode.count != 6)

            Button("Cancel and sign out") {
                mfaCode = ""
                errorMessage = nil
                Task { await auth.signOut() }
            }
            .buttonStyle(PillButtonStyle(variant: .soft))
            .frame(maxWidth: .infinity)
        }
        .padding(20)
        .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28).stroke(EmberRoseTheme.border))
    }

    private enum BannerStyle { case error, warning, info }

    private func banner(text: String, style: BannerStyle) -> some View {
        let colors: (Color, Color) = {
            switch style {
            case .error: return (Color.red.opacity(0.12), .red)
            case .warning: return (Color.orange.opacity(0.12), .orange)
            case .info: return (EmberRoseTheme.accentSoft, EmberRoseTheme.accent)
            }
        }()
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: style == .error ? "exclamationmark.triangle" : "info.circle")
            Text(text)
                .font(.subheadline)
        }
        .foregroundStyle(colors.1)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.0, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func handleSubmit() async {
        errorMessage = nil
        infoMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }

        if isLogin {
            let result = await auth.signIn(email: email, password: password)
            if case .failure(let message) = result {
                errorMessage = message
            }
        } else {
            let result = await auth.signUp(email: email, password: password)
            switch result {
            case .success(let notice):
                if let notice { infoMessage = notice }
            case .failure(let message):
                errorMessage = message
            }
        }
    }

    private func handleForgotPassword() async {
        errorMessage = nil
        infoMessage = nil
        guard !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Enter your account email first, then select Forgot password."
            return
        }
        isSubmitting = true
        let result = await auth.resetPassword(email: email)
        isSubmitting = false
        switch result {
        case .success:
            infoMessage = "Password reset email sent. Follow the link, then set a new password in Account → Security."
        case .failure(let message):
            errorMessage = message
        }
    }

    private func handleMfaSubmit() async {
        errorMessage = nil
        isSubmitting = true
        let result = await auth.completeMfaChallenge(code: mfaCode)
        isSubmitting = false
        if case .failure(let message) = result {
            errorMessage = message
            Haptics.errorNotification()
        } else {
            mfaCode = ""
            Haptics.successNotification()
        }
    }

    private func isStrongPassword(_ value: String) -> Bool {
        value.count >= 8 &&
            value.range(of: "[A-Z]", options: .regularExpression) != nil &&
            value.range(of: "[0-9]", options: .regularExpression) != nil
    }
}

private struct CheckboxToggleStyle: ToggleStyle {
    func makeBody(configuration: Configuration) -> some View {
        Button {
            configuration.isOn.toggle()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: configuration.isOn ? "checkmark.square.fill" : "square")
                    .foregroundStyle(configuration.isOn ? EmberRoseTheme.accent : EmberRoseTheme.inkMuted)
                configuration.label
            }
        }
        .buttonStyle(.plain)
    }
}

private extension ToggleStyle where Self == CheckboxToggleStyle {
    static var checkbox: CheckboxToggleStyle { CheckboxToggleStyle() }
}

#Preview {
    AuthView(auth: AuthViewModel())
}
