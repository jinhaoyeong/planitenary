import SwiftUI

extension Color {
    init(hex: String) {
        let sanitized = hex
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "#", with: "")

        var value: UInt64 = 0
        Scanner(string: sanitized).scanHexInt64(&value)

        let red, green, blue, alpha: Double
        switch sanitized.count {
        case 6:
            red = Double((value & 0xFF0000) >> 16) / 255
            green = Double((value & 0x00FF00) >> 8) / 255
            blue = Double(value & 0x0000FF) / 255
            alpha = 1
        case 8:
            red = Double((value & 0xFF000000) >> 24) / 255
            green = Double((value & 0x00FF0000) >> 16) / 255
            blue = Double((value & 0x0000FF00) >> 8) / 255
            alpha = Double(value & 0x000000FF) / 255
        default:
            red = 0
            green = 0
            blue = 0
            alpha = 1
        }

        self.init(.sRGB, red: red, green: green, blue: blue, opacity: alpha)
    }
}

struct AppColors {
    let bg: Color
    let bgElevated: Color
    let ink: Color
    let inkMuted: Color
    let accent: Color
    let accentSoft: Color

    init(palette: TripThemeSettings) {
        bg = Color(hex: palette.bg)
        bgElevated = Color(hex: palette.bgElevated)
        ink = Color(hex: palette.ink)
        inkMuted = Color(hex: palette.inkMuted)
        accent = Color(hex: palette.accent)
        accentSoft = Color(hex: palette.accentSoft)
    }
}

@MainActor
final class ThemeManager: ObservableObject {
    static let globalThemeKey = "theme"

    @Published private(set) var mode: ThemeMode

    private let userDefaults: UserDefaults
    private var userId: String?

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults

        if let saved = userDefaults.string(forKey: Self.globalThemeKey),
           let parsed = ThemeMode(rawValue: saved) {
            mode = parsed
        } else {
            mode = .light
        }
    }

    func setUserId(_ userId: String?) {
        self.userId = userId
        guard let userId else { return }
        let accountKey = Self.themeKey(for: userId)
        if let saved = userDefaults.string(forKey: accountKey),
           let parsed = ThemeMode(rawValue: saved) {
            mode = parsed
        }
    }

    func toggleTheme() {
        setTheme(mode == .light ? .dark : .light)
    }

    func setTheme(_ newMode: ThemeMode) {
        mode = newMode
        userDefaults.set(newMode.rawValue, forKey: Self.globalThemeKey)
        if let userId {
            userDefaults.set(newMode.rawValue, forKey: Self.themeKey(for: userId))
        }
    }

    func colors(from settings: TripAppSettings) -> AppColors {
        AppColors(palette: getThemeForMode(settings: settings, mode: mode))
    }

    func colors(from shell: ShellThemePalettes) -> AppColors {
        let palette = mode == .light ? shell.light : shell.dark
        return AppColors(palette: palette)
    }

    static func themeKey(for userId: String) -> String {
        "theme-\(userId)"
    }
}

extension Font {
    static func instrumentSans(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static func instrumentSansRounded(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .rounded)
    }

    static func instrumentSerif(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        .system(size: size, weight: weight, design: .serif)
    }

    static func instrumentSerifDisplay(_ size: CGFloat) -> Font {
        .system(size: size, weight: .regular, design: .serif)
    }
}

enum ShellChrome {
    static let background = Color(hex: "#FAF7F2")
    static let cardBackground = Color.white
    static let border = Color(hex: "#E8E1D5")
    static let accent = Color(hex: "#EE4D87")
    static let accentSoft = Color(hex: "#FFE4EE")
    static let ink = Color(hex: "#0F0E0D")
    static let inkMuted = Color(hex: "#5C5853")

    static func elevatedCard() -> some ViewModifier {
        ElevatedCardModifier()
    }
}

private struct ElevatedCardModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(ShellChrome.cardBackground)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(ShellChrome.border, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.06), radius: 16, x: 0, y: 8)
    }
}

extension View {
    func shellCard() -> some View {
        modifier(ElevatedCardModifier())
    }
}
