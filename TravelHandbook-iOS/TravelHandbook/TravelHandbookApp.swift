import SwiftUI

@main
struct TravelHandbookApp: App {
    @StateObject private var authViewModel = AuthViewModel()
    @StateObject private var themeManager = ThemeManager()
    @StateObject private var currencyManager = CurrencyManager.shared

    var body: some Scene {
        WindowGroup {
            AppRootView()
                .environmentObject(authViewModel)
                .environmentObject(themeManager)
                .environmentObject(currencyManager)
                .preferredColorScheme(themeManager.mode == .dark ? .dark : .light)
        }
    }
}
