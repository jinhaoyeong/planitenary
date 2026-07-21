import SwiftUI

struct AppRootView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var theme: ThemeManager
    @StateObject private var tripSession = TripSession()

    @State private var showWelcome = !LocalStore.hasVisited()

    var body: some View {
        Group {
            if auth.isLoading {
                loadingScreen
            } else if showWelcome {
                WelcomeView {
                    LocalStore.markVisited()
                    showWelcome = false
                }
            } else if shouldShowAuth {
                AuthView(auth: auth)
            } else if shouldShowMfaSetup {
                MfaSetupView(auth: auth)
            } else if tripSession.activeItineraryId == nil {
                DashboardView(tripSession: tripSession)
            } else {
                TripRootView(tripSession: tripSession)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: auth.isLoading)
        .animation(.easeInOut(duration: 0.25), value: tripSession.activeItineraryId)
        .onChange(of: auth.user?.id) { _, newValue in
            tripSession.itineraryOwnerHint = newValue
            theme.setUserId(newValue)
            if newValue == nil {
                tripSession.closeTrip()
            }
        }
        .onAppear {
            tripSession.itineraryOwnerHint = auth.user?.id
            theme.setUserId(auth.user?.id)
        }
    }

    private var loadingScreen: some View {
        ZStack {
            ShellChrome.background.ignoresSafeArea()
            VStack(spacing: 16) {
                ProgressView()
                    .tint(ShellChrome.accent)
                Text("Loading Travel Handbook…")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
        }
    }

    private var shouldShowAuth: Bool {
        auth.user == nil || auth.needsMfaVerification
    }

    private var shouldShowMfaSetup: Bool {
        guard auth.user != nil, !auth.needsMfaVerification else { return false }
        guard auth.mfaStatusReady, !auth.skipsCloudGates else { return false }
        return !auth.mfaEnabled
    }
}
