import CoreImage.CIFilterBuiltins
import PhotosUI
import SwiftUI
import UIKit

struct AccountView: View {
    @EnvironmentObject private var auth: AuthViewModel

    @State private var profile = UserProfile.empty
    @State private var selectedAvatarItem: PhotosPickerItem?
    @State private var profileMessage: String?
    @State private var profileError: String?
    @State private var securityMessage: String?
    @State private var securityError: String?
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var disableCode = ""
    @State private var verifyCode = ""
    @State private var enrollDraft: AccountMfaEnrollmentDraft?
    @State private var isSavingProfile = false
    @State private var isChangingPassword = false
    @State private var isMfaBusy = false
    @State private var didCopySecret = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                SectionHeader(eyebrow: "Account", title: "Profile & Security")
                ProfilePanel(
                    profile: $profile,
                    selectedAvatarItem: $selectedAvatarItem,
                    message: profileMessage,
                    error: profileError,
                    isSaving: isSavingProfile,
                    avatarPreview: avatarPreview,
                    onSave: saveProfile
                )
                SecurityPanel(
                    auth: auth,
                    currentPassword: $currentPassword,
                    newPassword: $newPassword,
                    disableCode: $disableCode,
                    verifyCode: $verifyCode,
                    enrollDraft: $enrollDraft,
                    message: securityMessage,
                    error: securityError,
                    isChangingPassword: isChangingPassword,
                    isMfaBusy: isMfaBusy,
                    didCopySecret: $didCopySecret,
                    onChangePassword: changePassword,
                    onStartEnrollment: startEnrollment,
                    onConfirmEnrollment: confirmEnrollment,
                    onDisableMfa: disableMfa
                )
            }
            .padding(20)
        }
        .background(ShellChrome.background)
        .task(id: auth.user?.id) {
            loadProfile()
            if !auth.skipsCloudGates && SupabaseClient.shared.isConfigured {
                await auth.refreshMfaStatus()
            }
        }
        .onChange(of: selectedAvatarItem) { _, newValue in
            guard let newValue else { return }
            Task { await loadAvatar(from: newValue) }
        }
    }

    private var avatarPreview: some View {
        Group {
            if let uiImage = imageFromDataURL(profile.avatarDataURL) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    Circle()
                        .fill(ShellChrome.accentSoft)
                    Text(initials)
                        .font(.title2.weight(.bold))
                        .foregroundStyle(ShellChrome.accent)
                }
            }
        }
    }

    private var initials: String {
        let source = profile.displayName.isEmpty ? profile.fullName : profile.displayName
        let tokens = source.split(separator: " ").prefix(2)
        let letters = tokens.compactMap { $0.first }.map(String.init).joined()
        return letters.isEmpty ? "TH" : letters.uppercased()
    }

    private func loadProfile() {
        guard let user = auth.user else {
            profile = .empty
            return
        }
        var stored = LocalStore.loadProfile(userId: user.id)
        stored.email = user.email ?? stored.email
        if stored.displayName.isEmpty, let email = user.email {
            stored.displayName = email.split(separator: "@").first.map(String.init) ?? ""
        }
        profile = stored
        profileMessage = nil
        profileError = nil
        securityMessage = nil
        securityError = nil
        currentPassword = ""
        newPassword = ""
        disableCode = ""
        verifyCode = ""
        enrollDraft = nil
        selectedAvatarItem = nil
    }

    private func saveProfile() {
        guard let user = auth.user else {
            profileError = "Sign in before editing your account profile."
            return
        }
        isSavingProfile = true
        defer { isSavingProfile = false }

        profile.displayName = profile.displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        profile.fullName = profile.fullName.trimmingCharacters(in: .whitespacesAndNewlines)
        profile.location = profile.location.trimmingCharacters(in: .whitespacesAndNewlines)
        profile.bio = profile.bio.trimmingCharacters(in: .whitespacesAndNewlines)
        profile.email = user.email ?? profile.email

        LocalStore.saveProfile(profile, userId: user.id)
        profileMessage = "Saved profile locally for this account."
        profileError = nil
        Haptics.successNotification()
    }

    private func loadAvatar(from item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                profileError = "Could not load the selected avatar."
                return
            }
            profile.avatarDataURL = dataURL(for: data)
            profileMessage = "Avatar updated. Save profile to keep it."
            profileError = nil
            Haptics.lightImpact()
        } catch {
            profileError = error.localizedDescription
        }
    }

    private func changePassword() {
        guard !newPassword.isEmpty else {
            securityError = "Enter a new password first."
            return
        }

        isChangingPassword = true
        securityError = nil
        securityMessage = nil

        Task {
            defer { isChangingPassword = false }
            do {
                try await AuthService.shared.changePassword(
                    email: auth.user?.email,
                    currentPassword: currentPassword,
                    newPassword: newPassword,
                    isLocalTestUser: auth.isLocalTestUser,
                    isDemoUser: auth.isDemoUser
                )
                currentPassword = ""
                newPassword = ""
                securityMessage = "Password updated successfully."
                Haptics.successNotification()
            } catch let error as SupabaseAuthError {
                securityError = error.message
                Haptics.errorNotification()
            } catch {
                securityError = error.localizedDescription
                Haptics.errorNotification()
            }
        }
    }

    private func startEnrollment() {
        isMfaBusy = true
        securityError = nil
        securityMessage = nil
        didCopySecret = false

        Task {
            defer { isMfaBusy = false }
            do {
                let status = try await AuthService.shared.fetchMfaStatus()
                if status.isEnabled {
                    await auth.refreshMfaStatus()
                    securityMessage = "Two-factor authentication is already enabled."
                    return
                }
                if !status.unverifiedFactors.isEmpty {
                    await AuthService.shared.cleanupUnverifiedFactors(status.unverifiedFactors)
                }

                let response = try await AuthService.shared.enrollTotp(
                    friendlyName: "Travel Handbook \(ISO8601DateFormatter().string(from: Date()))"
                )
                guard let totp = response.totp else {
                    securityError = "TOTP enrollment is unavailable right now."
                    return
                }
                guard let secret = totp.secret, !secret.isEmpty else {
                    securityError = "Enrollment did not return a TOTP secret."
                    return
                }

                let payload = totp.uri ?? buildOtpURI(secret: secret, email: auth.user?.email ?? "user")
                enrollDraft = AccountMfaEnrollmentDraft(factorId: response.id, secret: secret, qrPayload: payload)
                securityMessage = "Scan the QR code in your authenticator app, then verify with a 6-digit code."
                Haptics.lightImpact()
            } catch let error as SupabaseAuthError {
                securityError = error.message
            } catch {
                securityError = error.localizedDescription
            }
        }
    }

    private func confirmEnrollment() {
        guard let draft = enrollDraft else { return }
        isMfaBusy = true
        securityError = nil

        Task {
            defer { isMfaBusy = false }
            do {
                try await AuthService.shared.verifyEnrollment(factorId: draft.factorId, code: verifyCode)
                verifyCode = ""
                enrollDraft = nil
                await auth.refreshMfaStatus()
                securityMessage = "Two-factor authentication is enabled."
                Haptics.successNotification()
            } catch let error as SupabaseAuthError {
                securityError = error.message
                Haptics.errorNotification()
            } catch {
                securityError = error.localizedDescription
                Haptics.errorNotification()
            }
        }
    }

    private func disableMfa() {
        guard let factorId = auth.mfaFactorId else {
            securityError = "No verified authenticator is connected to this account."
            return
        }
        isMfaBusy = true
        securityError = nil
        securityMessage = nil

        Task {
            defer { isMfaBusy = false }
            do {
                try await AuthService.shared.disableTotp(factorId: factorId, code: disableCode)
                disableCode = ""
                await auth.refreshMfaStatus()
                securityMessage = "Two-factor authentication was disabled."
                Haptics.successNotification()
            } catch let error as SupabaseAuthError {
                securityError = error.message
                Haptics.errorNotification()
            } catch {
                securityError = error.localizedDescription
                Haptics.errorNotification()
            }
        }
    }

    private func imageFromDataURL(_ dataURL: String?) -> UIImage? {
        guard let dataURL,
              let comma = dataURL.firstIndex(of: ",") else { return nil }
        let encoded = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: encoded) else { return nil }
        return UIImage(data: data)
    }

    private func dataURL(for data: Data) -> String {
        let mime = data.isPNG ? "image/png" : "image/jpeg"
        return "data:\(mime);base64,\(data.base64EncodedString())"
    }

    private func buildOtpURI(secret: String, email: String) -> String {
        let label = "Travel Handbook:\(email)".addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? email
        return "otpauth://totp/\(label)?secret=\(secret)&issuer=Travel%20Handbook"
    }
}

private struct ProfilePanel<AvatarPreview: View>: View {
    @Binding var profile: UserProfile
    @Binding var selectedAvatarItem: PhotosPickerItem?
    let message: String?
    let error: String?
    let isSaving: Bool
    @ViewBuilder let avatarPreview: AvatarPreview
    let onSave: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Profile")
                .font(.headline)
                .foregroundStyle(ShellChrome.ink)

            if let error {
                AccountBanner(text: error, isError: true)
            }
            if let message {
                AccountBanner(text: message, isError: false)
            }

            HStack(spacing: 16) {
                avatarPreview
                    .frame(width: 82, height: 82)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(ShellChrome.border, lineWidth: 1))

                VStack(alignment: .leading, spacing: 8) {
                    PhotosPicker(selection: $selectedAvatarItem, matching: .images) {
                        Label("Choose Avatar", systemImage: "photo")
                    }
                    .buttonStyle(PillButtonStyle(variant: .soft))

                    if profile.avatarDataURL != nil {
                        Button("Remove Avatar") {
                            profile.avatarDataURL = nil
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ShellChrome.accent)
                    }
                }

                Spacer()
            }

            AccountTextField(title: "Display name", text: $profile.displayName)
            AccountTextField(title: "Full name", text: $profile.fullName)
            AccountTextField(title: "Location", text: $profile.location)
            AccountMultilineField(title: "Bio", text: $profile.bio)

            VStack(alignment: .leading, spacing: 6) {
                Text("Email")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ShellChrome.ink)
                Text(profile.email.isEmpty ? "No email" : profile.email)
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(ShellChrome.border, lineWidth: 1)
                    )
            }

            PillButton(
                title: isSaving ? "Saving…" : "Save Profile",
                systemImage: "person.crop.circle.badge.checkmark",
                kind: .primary,
                isEnabled: !isSaving,
                action: onSave
            )
        }
        .padding(18)
        .shellCard()
    }
}

private struct SecurityPanel: View {
    @ObservedObject var auth: AuthViewModel
    @Binding var currentPassword: String
    @Binding var newPassword: String
    @Binding var disableCode: String
    @Binding var verifyCode: String
    @Binding var enrollDraft: AccountMfaEnrollmentDraft?
    let message: String?
    let error: String?
    let isChangingPassword: Bool
    let isMfaBusy: Bool
    @Binding var didCopySecret: Bool
    let onChangePassword: () -> Void
    let onStartEnrollment: () -> Void
    let onConfirmEnrollment: () -> Void
    let onDisableMfa: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Security")
                .font(.headline)
                .foregroundStyle(ShellChrome.ink)

            if let error {
                AccountBanner(text: error, isError: true)
            }
            if let message {
                AccountBanner(text: message, isError: false)
            }

            VStack(alignment: .leading, spacing: 12) {
                Text("Change password")
                    .font(.subheadline.weight(.semibold))
                AccountSecureField(title: "Current password", text: $currentPassword)
                AccountSecureField(title: "New password", text: $newPassword)
                Text("Use at least 8 characters with 1 uppercase letter and 1 number.")
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)

                PillButton(
                    title: isChangingPassword ? "Updating…" : "Change Password",
                    systemImage: "lock.rotation",
                    kind: .soft,
                    isEnabled: !isChangingPassword,
                    action: onChangePassword
                )
            }

            Divider()

            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Authenticator MFA")
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    statusBadge
                }

                if auth.isDemoUser || auth.isLocalTestUser || !SupabaseClient.shared.isConfigured {
                    Text("Two-factor authentication is only available for configured cloud accounts.")
                        .font(.subheadline)
                        .foregroundStyle(ShellChrome.inkMuted)
                } else if !auth.mfaStatusReady {
                    ProgressView("Checking security status…")
                } else if let draft = enrollDraft {
                    enrollmentCard(draft: draft)
                } else if auth.mfaEnabled {
                    enabledMfaCard
                } else {
                    Text("Add a TOTP authenticator app like 1Password, Authy, or Google Authenticator.")
                        .font(.subheadline)
                        .foregroundStyle(ShellChrome.inkMuted)

                    PillButton(
                        title: isMfaBusy ? "Starting…" : "Enroll Authenticator",
                        systemImage: "qrcode",
                        kind: .primary,
                        isEnabled: !isMfaBusy,
                        action: onStartEnrollment
                    )
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text("Phone")
                    .font(.subheadline.weight(.semibold))
                Text("Phone-based security is not wired up in the iOS shell yet.")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
                TextField("Coming soon", text: .constant(""))
                    .disabled(true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(ShellChrome.border, lineWidth: 1)
                    )
            }
        }
        .padding(18)
        .shellCard()
    }

    private var statusBadge: some View {
        Text(auth.mfaEnabled ? "Enabled" : "Not enabled")
            .font(.caption.weight(.bold))
            .foregroundStyle(auth.mfaEnabled ? ShellChrome.accent : ShellChrome.inkMuted)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(
                auth.mfaEnabled ? ShellChrome.accentSoft : ShellChrome.background,
                in: Capsule()
            )
    }

    private var enabledMfaCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Enter a fresh 6-digit code from your authenticator app to disable MFA.")
                .font(.subheadline)
                .foregroundStyle(ShellChrome.inkMuted)
            AccountCodeField(title: "Authenticator code", text: $disableCode)
            PillButton(
                title: isMfaBusy ? "Disabling…" : "Disable Authenticator",
                systemImage: "shield.slash",
                kind: .soft,
                isEnabled: !isMfaBusy && disableCode.count == 6,
                action: onDisableMfa
            )
        }
        .padding(16)
        .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(ShellChrome.border, lineWidth: 1)
        )
    }

    private func enrollmentCard(draft: AccountMfaEnrollmentDraft) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Scan the QR code in your authenticator app.")
                .font(.subheadline)
                .foregroundStyle(ShellChrome.inkMuted)

            if let image = qrImage(from: draft.qrPayload) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 200, maxHeight: 200)
                    .frame(maxWidth: .infinity)
                    .padding(12)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Manual secret")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ShellChrome.inkMuted)
                Text(draft.secret)
                    .font(.system(.body, design: .monospaced))
                    .textSelection(.enabled)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ShellChrome.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(ShellChrome.border, lineWidth: 1)
                    )
                Button(didCopySecret ? "Copied" : "Copy Secret") {
                    UIPasteboard.general.string = draft.secret
                    didCopySecret = true
                    Haptics.successNotification()
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.accent)
            }

            AccountCodeField(title: "Verification code", text: $verifyCode)
            PillButton(
                title: isMfaBusy ? "Verifying…" : "Verify Authenticator",
                systemImage: "checkmark.shield",
                kind: .primary,
                isEnabled: !isMfaBusy && verifyCode.count == 6,
                action: onConfirmEnrollment
            )
        }
        .padding(16)
        .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(ShellChrome.border, lineWidth: 1)
        )
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

private struct AccountTextField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)
            TextField(title, text: $text)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(ShellChrome.border, lineWidth: 1)
                )
        }
    }
}

private struct AccountSecureField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)
            SecureField(title, text: $text)
                .textContentType(title.lowercased().contains("new") ? .newPassword : .password)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(ShellChrome.border, lineWidth: 1)
                )
        }
    }
}

private struct AccountMultilineField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)
            TextField(title, text: $text, axis: .vertical)
                .lineLimit(3...6)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(ShellChrome.border, lineWidth: 1)
                )
        }
    }
}

private struct AccountCodeField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)
            TextField("000000", text: $text)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .multilineTextAlignment(.center)
                .font(.title3.weight(.semibold))
                .tracking(6)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(ShellChrome.border, lineWidth: 1)
                )
                .onChange(of: text) { _, newValue in
                    text = String(newValue.filter(\.isNumber).prefix(6))
                }
        }
    }
}

private struct AccountBanner: View {
    let text: String
    let isError: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
            Text(text)
                .font(.subheadline)
        }
        .foregroundStyle(isError ? .red : ShellChrome.accent)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            (isError ? Color.red.opacity(0.1) : ShellChrome.accentSoft),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
    }
}

private struct AccountMfaEnrollmentDraft {
    let factorId: String
    let secret: String
    let qrPayload: String
}

private extension Data {
    var isPNG: Bool {
        count >= 8 && prefix(8) == Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    }
}
