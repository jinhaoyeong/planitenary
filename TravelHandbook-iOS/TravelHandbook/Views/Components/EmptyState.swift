import SwiftUI

struct EmptyState: View {
    let systemImage: String
    let title: String
    let message: String
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: systemImage)
                .font(.system(size: 40, weight: .semibold))
                .foregroundStyle(ShellChrome.accent)
                .frame(width: 72, height: 72)
                .background(ShellChrome.accentSoft)
                .clipShape(Circle())

            VStack(spacing: 8) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(ShellChrome.ink)
                Text(message)
                    .font(.subheadline)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(ShellChrome.inkMuted)
            }

            if let actionTitle, let action {
                PillButton(title: actionTitle, kind: .soft, action: action)
                    .frame(maxWidth: 220)
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity)
    }
}
