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
    let border: Color

    init(palette: TripThemeSettings, mode: ThemeMode) {
        bg = Color(hex: palette.bg)
        bgElevated = Color(hex: palette.bgElevated)
        ink = Color(hex: palette.ink)
        inkMuted = Color(hex: palette.inkMuted)
        accent = Color(hex: palette.accent)
        accentSoft = Color(hex: palette.accentSoft)
        border = Color(hex: mode == .dark ? "#2C2521" : "#E8E1D5")
    }
}

@MainActor
final class ThemeManager: ObservableObject {
    static let globalThemeKey = "theme"

    @Published private(set) var mode: ThemeMode
    /// Bumps when palette/mode changes so views using ShellChrome redraw.
    @Published private(set) var renderToken: String = "light"

    private let userDefaults: UserDefaults
    private var userId: String?
    private var tripSettings: TripAppSettings?
    private var shellPalettes: ShellThemePalettes = .default

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults

        if let saved = userDefaults.string(forKey: Self.globalThemeKey),
           let parsed = ThemeMode(rawValue: saved) {
            mode = parsed
        } else if let systemDark = UserDefaults.standard.object(forKey: "AppleInterfaceStyle") as? String,
                  systemDark.lowercased() == "dark" {
            mode = .dark
        } else {
            mode = .dark
        }

        shellPalettes = LocalStore.loadShellTheme(userId: nil)
        publishPalette()
    }

    func setUserId(_ userId: String?) {
        self.userId = userId
        shellPalettes = LocalStore.loadShellTheme(userId: userId)
        if let userId,
           let saved = userDefaults.string(forKey: Self.themeKey(for: userId)),
           let parsed = ThemeMode(rawValue: saved) {
            mode = parsed
        }
        // Leaving a trip should fall back to shell palette.
        if tripSettings == nil {
            publishPalette()
        } else {
            publishPalette()
        }
    }

    func applyShellPalette(userId: String?) {
        shellPalettes = LocalStore.loadShellTheme(userId: userId)
        if tripSettings == nil {
            publishPalette()
        }
    }

    func applyTripSettings(_ settings: TripAppSettings?) {
        tripSettings = settings
        publishPalette()
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
        publishPalette()
    }

    func colors(from settings: TripAppSettings) -> AppColors {
        AppColors(palette: getThemeForMode(settings: settings, mode: mode), mode: mode)
    }

    func colors(from shell: ShellThemePalettes) -> AppColors {
        let palette = mode == .light ? shell.light : shell.dark
        return AppColors(palette: palette, mode: mode)
    }

    nonisolated static func themeKey(for userId: String) -> String {
        LocalStore.themeKey(userId: userId)
    }

    private func publishPalette() {
        let palette: TripThemeSettings
        if let tripSettings {
            palette = getThemeForMode(settings: tripSettings, mode: mode)
        } else {
            palette = mode == .light ? shellPalettes.light : shellPalettes.dark
        }
        ShellChrome.apply(palette, mode: mode)
        renderToken = "\(mode.rawValue)-\(palette.bg)-\(palette.accent)-\(palette.bgElevated)"
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

/// Shared chrome colors. Call `ThemeManager` methods so `apply` runs; views should also observe `theme.renderToken`.
enum ShellChrome {
    @MainActor private static var palette = DEFAULT_LIGHT_THEME
    @MainActor private static var mode: ThemeMode = .light

    @MainActor
    static func apply(_ palette: TripThemeSettings, mode: ThemeMode) {
        self.palette = palette
        self.mode = mode
    }

    @MainActor static var background: Color { Color(hex: palette.bg) }
    @MainActor static var cardBackground: Color { Color(hex: palette.bgElevated) }
    @MainActor static var border: Color { Color(hex: mode == .dark ? "#2C2521" : "#E8E1D5") }
    @MainActor static var accent: Color { Color(hex: palette.accent) }
    @MainActor static var accentSoft: Color { Color(hex: palette.accentSoft) }
    @MainActor static var ink: Color { Color(hex: palette.ink) }
    @MainActor static var inkMuted: Color { Color(hex: palette.inkMuted) }
    @MainActor static var isDark: Bool { mode == .dark }

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
            .shadow(color: Color.black.opacity(ShellChrome.isDark ? 0.35 : 0.06), radius: 16, x: 0, y: 8)
    }
}

extension View {
    func shellCard() -> some View {
        modifier(ElevatedCardModifier())
    }

    /// Forces chrome-using views to redraw when ThemeManager publishes a new palette.
    func handbookTheme(_ theme: ThemeManager) -> some View {
        id(theme.renderToken)
    }
}
