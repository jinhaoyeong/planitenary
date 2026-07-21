import SwiftUI

struct TripRootView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var theme: ThemeManager
    @ObservedObject var tripSession: TripSession

    @State private var isMenuPresented = false
    @State private var isRestorePresented = false
    @State private var selectedRestoreIds: Set<RestoreDatasetId> = []
    @State private var restoreMessage: String?
    @State private var isRestoreBusy = false

    var body: some View {
        ZStack(alignment: .bottom) {
            ShellChrome.background.ignoresSafeArea()

            VStack(spacing: 0) {
                tripHeader
                tabContent
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            if tripSession.activeTab.showsInPrimaryPillBar {
                primaryTabBar
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
        }
        .sheet(isPresented: $isMenuPresented) {
            tripMenuSheet
        }
        .sheet(isPresented: $isRestorePresented) {
            restoreBackupSheet
        }
    }

    private var tripHeader: some View {
        HStack(spacing: 12) {
            Button {
                tripSession.saveTripData()
                persistShellThemeFromTrip()
                tripSession.closeTrip()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(ShellChrome.ink)
                    .frame(width: 36, height: 36)
                    .background(ShellChrome.cardBackground)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(ShellChrome.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Back to dashboard")

            VStack(alignment: .leading, spacing: 2) {
                Text(tripSession.tripDisplayName)
                    .font(.headline)
                    .foregroundStyle(ShellChrome.ink)
                    .lineLimit(1)
                Text("Travel Handbook")
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)
            }

            Spacer()

            headerIconButton(systemImage: "slider.horizontal.3") {
                tripSession.activeTab = .settings
            }
            headerIconButton(systemImage: "person.crop.circle") {
                tripSession.activeTab = .account
            }
            headerIconButton(systemImage: "line.3.horizontal") {
                isMenuPresented = true
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(ShellChrome.background)
    }

    private func headerIconButton(systemImage: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)
                .frame(width: 36, height: 36)
                .background(ShellChrome.cardBackground)
                .clipShape(Circle())
                .overlay(Circle().stroke(ShellChrome.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var tabContent: some View {
        switch tripSession.activeTab {
        case .itinerary:
            ScrollView {
                ItineraryHomeView(session: tripSession)
                    .padding(.bottom, 120)
            }
            .refreshable {
                await tripSession.refreshItineraryFromCloud(auth: auth)
            }
        case .maps:
            MapsView(session: tripSession)
                .padding(.bottom, 120)
        case .draft:
            ScrollView { DraftView(session: tripSession).padding(.bottom, 120) }
        case .budget:
            ScrollView { BudgetView(session: tripSession).padding(.bottom, 120) }
        case .checklist:
            ScrollView { ChecklistView(session: tripSession).padding(.bottom, 120) }
        case .documents:
            ScrollView { DocumentsView(session: tripSession).padding(.bottom, 24) }
        case .photos:
            ScrollView { PhotoWallView(session: tripSession).padding(.bottom, 24) }
        case .settings:
            ScrollView { HandbookSettingsView(session: tripSession).padding(.bottom, 24) }
        case .account:
            AccountView()
        }
    }

    private var primaryTabBar: some View {
        HStack(spacing: 0) {
            ForEach(TripTab.primaryPillTabs) { tab in
                Button {
                    tripSession.activeTab = tab
                } label: {
                    VStack(spacing: 6) {
                        ZStack {
                            if tripSession.activeTab == tab {
                                Circle()
                                    .fill(ShellChrome.accent)
                                    .frame(width: 40, height: 40)
                            }
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(tripSession.activeTab == tab ? Color.white : ShellChrome.inkMuted)
                        }
                        Text(shortTabLabel(tab))
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(tripSession.activeTab == tab ? ShellChrome.accent : ShellChrome.inkMuted)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(ShellChrome.cardBackground)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(ShellChrome.border, lineWidth: 1))
        .shadow(color: Color.black.opacity(0.08), radius: 18, x: 0, y: 8)
    }

    private func shortTabLabel(_ tab: TripTab) -> String {
        switch tab {
        case .itinerary: return tripSession.tripSettings.labels.itineraryTab
        case .maps: return tripSession.tripSettings.labels.mapsTab
        case .draft: return tripSession.tripSettings.labels.draftTab
        case .budget: return tripSession.tripSettings.labels.budgetTab
        case .checklist: return tripSession.tripSettings.labels.checklistTab
        default: return tab.title
        }
    }

    private var tripMenuSheet: some View {
        NavigationStack {
            List {
                Section("Trip") {
                    ForEach(TripTab.allCases) { tab in
                        Button {
                            tripSession.activeTab = tab
                            isMenuPresented = false
                        } label: {
                            Label(tab.title, systemImage: tab.systemImage)
                        }
                    }
                }

                Section("Handbook") {
                    Button {
                        isMenuPresented = false
                        isRestorePresented = true
                    } label: {
                        Label("Restore Backup", systemImage: "arrow.counterclockwise")
                    }

                    Button {
                        theme.toggleTheme()
                    } label: {
                        Label(theme.mode == .light ? "Dark theme" : "Light theme", systemImage: theme.mode == .light ? "moon.fill" : "sun.max.fill")
                    }
                }

                Section {
                    Button(role: .destructive) {
                        isMenuPresented = false
                        Task { await auth.signOut() }
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .navigationTitle("Menu")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { isMenuPresented = false }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var restoreBackupSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Choose datasets to restore from local backup copies.")
                        .font(.subheadline)
                        .foregroundStyle(ShellChrome.inkMuted)

                    let previews = tripSession.restorePreview(userId: auth.user?.id)
                    ForEach(previews) { preview in
                        Toggle(isOn: bindingForRestore(preview.id)) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(preview.id.label)
                                    .font(.subheadline.weight(.semibold))
                                Text(preview.detail)
                                    .font(.caption)
                                    .foregroundStyle(ShellChrome.inkMuted)
                            }
                        }
                        .toggleStyle(SwitchToggleStyle(tint: ShellChrome.accent))
                        .disabled(!preview.isAvailable)
                    }

                    if let restoreMessage {
                        Text(restoreMessage)
                            .font(.footnote)
                            .foregroundStyle(ShellChrome.inkMuted)
                    }

                    PillButton(title: isRestoreBusy ? "Restoring…" : "Restore", kind: .primary, isEnabled: !selectedRestoreIds.isEmpty && !isRestoreBusy) {
                        performRestore()
                    }

                    if SupabaseClient.shared.isConfigured, !auth.skipsCloudGates {
                        PillButton(title: "Backup to Cloud", kind: .soft, isEnabled: !isRestoreBusy) {
                            Task {
                                isRestoreBusy = true
                                let ok = await tripSession.backupTripToCloud(auth: auth)
                                restoreMessage = ok ? "Trip backup pushed to cloud." : "Cloud backup is not available."
                                isRestoreBusy = false
                            }
                        }
                    }

                    PillButton(
                        title: "Undo Last Restore",
                        kind: .ghost,
                        isEnabled: tripSession.hasUndoRestoreSnapshot && !isRestoreBusy
                    ) {
                        if tripSession.undoLastRestore(userId: auth.user?.id) {
                            restoreMessage = "Restored previous snapshot."
                        }
                    }
                }
                .padding(20)
            }
            .background(ShellChrome.background)
            .navigationTitle("Restore Backup")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close") { isRestorePresented = false }
                }
            }
            .onAppear {
                selectedRestoreIds = Set(
                    tripSession.restorePreview(userId: auth.user?.id)
                        .filter(\.isAvailable)
                        .map(\.id)
                )
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func bindingForRestore(_ id: RestoreDatasetId) -> Binding<Bool> {
        Binding(
            get: { selectedRestoreIds.contains(id) },
            set: { isOn in
                if isOn {
                    selectedRestoreIds.insert(id)
                } else {
                    selectedRestoreIds.remove(id)
                }
            }
        )
    }

    private func performRestore() {
        isRestoreBusy = true
        let count = tripSession.restoreSelected(Array(selectedRestoreIds), userId: auth.user?.id)
        restoreMessage = count > 0 ? "Restored \(count) dataset(s)." : "Nothing was restored."
        isRestoreBusy = false
    }

    private func persistShellThemeFromTrip() {
        let palettes = shellThemeFromTripSettings(tripSession.tripSettings)
        LocalStore.saveShellTheme(palettes, userId: auth.user?.id)
    }
}
