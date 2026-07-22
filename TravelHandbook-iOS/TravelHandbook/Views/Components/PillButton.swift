import SwiftUI

enum PillButtonStyleKind {
    case primary
    case ghost
    case soft
}

struct PillButton: View {
    let title: String
    var systemImage: String? = nil
    var kind: PillButtonStyleKind = .primary
    var isEnabled: Bool = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.subheadline.weight(.semibold))
                }
                Text(title)
                    .font(.subheadline.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .padding(.horizontal, 18)
            .foregroundStyle(foregroundColor)
            .background(backgroundColor)
            .clipShape(Capsule())
            .overlay(
                Capsule()
                    .stroke(borderColor, lineWidth: kind == .ghost ? 1 : 0)
            )
        }
        .buttonStyle(.plain)
        .disabled(!isEnabled)
        .opacity(isEnabled ? 1 : 0.55)
    }

    private var foregroundColor: Color {
        switch kind {
        case .primary: return Color(hex: "#0F0E0D")
        case .ghost: return ShellChrome.ink
        case .soft: return ShellChrome.accent
        }
    }

    private var backgroundColor: Color {
        switch kind {
        case .primary: return ShellChrome.accent
        case .ghost: return Color.clear
        case .soft: return ShellChrome.accentSoft
        }
    }

    private var borderColor: Color {
        kind == .ghost ? ShellChrome.ink.opacity(0.45) : .clear
    }
}

struct CompactPillButton: View {
    let title: String
    var systemImage: String? = nil
    var kind: PillButtonStyleKind = .soft
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.caption.weight(.semibold))
                }
                Text(title)
                    .font(.caption.weight(.semibold))
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .foregroundStyle(kind == .primary ? Color(hex: "#0F0E0D") : (kind == .soft ? ShellChrome.accent : ShellChrome.ink))
            .background(kind == .primary ? ShellChrome.accent : (kind == .soft ? ShellChrome.accentSoft : Color.clear))
            .clipShape(Capsule())
            .overlay(
                Capsule().stroke(kind == .ghost ? ShellChrome.ink.opacity(0.45) : Color.clear, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}
