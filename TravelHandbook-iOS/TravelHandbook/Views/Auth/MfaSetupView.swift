import SwiftUI
import CoreImage.CIFilterBuiltins

struct MfaSetupView: View {
    @ObservedObject var auth: AuthViewModel

    @State private var enrollDraft: EnrollDraft?
    @State private var verifyCode = ""
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var isBusy = false
    @State private var didCopySecret = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header

                VStack(alignment: .leading, spacing: 6) {
                    Text("Cloud accounts must enroll an authenticator app before continuing.")
                        .font(.subheadline)
                        .foregroundStyle(EmberRoseTheme.inkMuted)
                    Text("Signed in as \(auth.user?.email ?? "")")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(EmberRoseTheme.ink)
                }

                if let errorMessage {
                    messageBanner(errorMessage, isError: true)
                }
                if let statusMessage {
                    messageBanner(statusMessage, isError: false)
                }

                if let draft = enrollDraft {
                    enrollmentPanel(draft)
                } else {
                    Button {
                        Task { await startEnrollment() }
                    } label: {
                        Text(isBusy ? "Starting…" : "Set up authenticator")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(PillButtonStyle(variant: .primary))
                    .disabled(isBusy)
                }

                Button("Sign out") {
                    Task { await auth.signOut() }
                }
                .buttonStyle(PillButtonStyle(variant: .soft))
                .frame(maxWidth: .infinity)
            }
            .padding(22)
        }
        .background(EmberRoseTheme.paperBackground.ignoresSafeArea())
        .task {
            await auth.refreshMfaStatus()
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "shield.checkered")
                .font(.title2)
                .foregroundStyle(EmberRoseTheme.accent)
                .frame(width: 48, height: 48)
                .background(EmberRoseTheme.accentSoft, in: Circle())
            VStack(alignment: .leading, spacing: 4) {
                Text("Required security")
                    .font(.caption.weight(.semibold))
                    .tracking(2)
                    .textCase(.uppercase)
                    .foregroundStyle(EmberRoseTheme.inkMuted)
                Text("Enable 2FA")
                    .font(.system(.title, design: .serif))
            }
        }
    }

    private func enrollmentPanel(_ draft: EnrollDraft) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Scan this QR code in Google Authenticator, 1Password, or Authy.")
                .font(.subheadline)
                .foregroundStyle(EmberRoseTheme.inkMuted)

            if let image = qrImage(from: draft.qrPayload) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 220, maxHeight: 220)
                    .frame(maxWidth: .infinity)
                    .padding(16)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Or enter this secret manually")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(EmberRoseTheme.inkMuted)
                Text(draft.secret)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(EmberRoseTheme.border))

                Button(didCopySecret ? "Copied" : "Copy secret") {
                    UIPasteboard.general.string = draft.secret
                    didCopySecret = true
                    Haptics.successNotification()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(EmberRoseTheme.accent)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("6-digit verification code")
                    .font(.subheadline.weight(.bold))
                TextField("000000", text: $verifyCode)
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.center)
                    .font(.title3.weight(.semibold))
                    .tracking(6)
                    .padding(14)
                    .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(EmberRoseTheme.border))
                    .onChange(of: verifyCode) { _, newValue in
                        verifyCode = String(newValue.filter(\.isNumber).prefix(6))
                    }
            }

            Button {
                Task { await confirmEnrollment(factorId: draft.factorId) }
            } label: {
                Text(isBusy ? "Verifying…" : "Continue")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(PillButtonStyle(variant: .primary))
            .disabled(isBusy || verifyCode.count != 6)
        }
        .padding(18)
        .background(EmberRoseTheme.cardBackground, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24).stroke(EmberRoseTheme.border))
    }

    private func messageBanner(_ text: String, isError: Bool) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(isError ? .red : EmberRoseTheme.ink)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                (isError ? Color.red.opacity(0.1) : EmberRoseTheme.accentSoft),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
    }

    private func startEnrollment() async {
        errorMessage = nil
        statusMessage = nil
        isBusy = true
        defer { isBusy = false }

        do {
            let status = try await AuthService.shared.fetchMfaStatus()
            if status.isEnabled {
                await auth.refreshMfaStatus()
                statusMessage = "Two-factor authentication is already enabled on this account."
                return
            }
            if !status.unverifiedFactors.isEmpty {
                await AuthService.shared.cleanupUnverifiedFactors(status.unverifiedFactors)
            }

            let response = try await AuthService.shared.enrollTotp(
                friendlyName: "Authenticator \(ISO8601DateFormatter().string(from: Date()))"
            )
            guard let totp = response.totp else {
                errorMessage = "Unable to start authenticator enrollment. Confirm TOTP MFA is enabled in Supabase."
                return
            }

            let qrPayload = totp.uri ?? buildOtpURI(secret: totp.secret ?? "", email: auth.user?.email ?? "user")
            guard let secret = totp.secret, !secret.isEmpty else {
                errorMessage = "Enrollment did not return a TOTP secret."
                return
            }

            enrollDraft = EnrollDraft(factorId: response.id, secret: secret, qrPayload: qrPayload)
            statusMessage = "Scan the QR code with your authenticator app, then enter the 6-digit code below."
            Haptics.lightImpact()
        } catch let error as SupabaseAuthError {
            errorMessage = error.message
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func confirmEnrollment(factorId: String) async {
        errorMessage = nil
        isBusy = true
        defer { isBusy = false }

        do {
            try await AuthService.shared.verifyEnrollment(factorId: factorId, code: verifyCode)
            enrollDraft = nil
            verifyCode = ""
            await auth.refreshMfaStatus()
            statusMessage = "Two-factor authentication is enabled. You're ready to continue."
            Haptics.successNotification()
        } catch let error as SupabaseAuthError {
            errorMessage = error.message
            Haptics.errorNotification()
        } catch {
            errorMessage = error.localizedDescription
            Haptics.errorNotification()
        }
    }

    private func buildOtpURI(secret: String, email: String) -> String {
        let label = "Travel Handbook:\(email)".addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? email
        return "otpauth://totp/\(label)?secret=\(secret)&issuer=Travel%20Handbook"
    }

    private func qrImage(from string: String) -> UIImage? {
        let context = CIContext()
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cgImage)
    }
}

private struct EnrollDraft {
    let factorId: String
    let secret: String
    let qrPayload: String
}

#Preview {
    MfaSetupView(auth: AuthViewModel())
}
