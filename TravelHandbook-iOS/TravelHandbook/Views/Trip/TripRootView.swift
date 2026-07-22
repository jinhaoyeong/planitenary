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

    private var marqueeItems: [String] {
        let settingsItems = tripSession.tripSettings.marqueeItems
        let fallback = settingsItems.isEmpty ? DEFAULT_TRIP_SETTINGS.marqueeItems : settingsItems
        let cities = tripSession.itinerary?.cities ?? []
        return cities.isEmpty ? fallback : cities + fallback
    }

    private var showsHeroInScroll: Bool {
        tripSession.activeTab.showsInPrimaryPillBar
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            ShellChrome.background.ignoresSafeArea()

            VStack(spacing: 0) {
                tripHeader

                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 0) {
                            // Web order: hero → cover → auto-slider → page title/content
                            if showsHeroInScroll {
                                TripHeroView(session: tripSession)
                                    .id("hero")
                            }

                            TripMarqueeView(items: marqueeItems)
                                .padding(.top, showsHeroInScroll ? 6 : 0)
                                .id("marquee")

                            tabContent
                                .id("page-title")
                                .padding(.top, 18)
                                .padding(.bottom, tripSession.activeTab.showsInPrimaryPillBar ? 120 : 28)
                        }
                    }
                    .onChange(of: tripSession.activeTab) { _, _ in
                        DispatchQueue.main.async {
                            withAnimation(.easeInOut(duration: 0.28)) {
                                proxy.scrollTo("page-title", anchor: .top)
                            }
                        }
                    }
                }
            }

            if tripSession.activeTab.showsInPrimaryPillBar {
                primaryTabBar
                    .padding(.horizontal, 16)
                    .padding(.bottom, 10)
            }
        }
        .handbookTheme(theme)
        .onAppear {
            syncTripTheme()
        }
        .onChange(of: tripSession.tripSettings) { _, _ in syncTripTheme() }
        .onChange(of: theme.mode) { _, _ in syncTripTheme() }
        .onDisappear {
            theme.applyTripSettings(nil)
            theme.applyShellPalette(userId: auth.user?.id)
        }
        .sheet(isPresented: $isMenuPresented) { tripMenuSheet }
        .sheet(isPresented: $isRestorePresented) { restoreBackupSheet }
    }

    private var tripHeader: some View {
        HStack(spacing: 10) {
            Button {
                tripSession.saveTripData()
                persistShellThemeFromTrip()
                tripSession.closeTrip()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(ShellChrome.ink)
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)

            Spacer(minLength: 0)

            (
                Text(brandLeading)
                    .foregroundStyle(ShellChrome.ink)
                + Text(brandAccent)
                    .italic()
                    .foregroundStyle(ShellChrome.accent)
            )
            .font(.system(size: 22, weight: .regular, design: .serif))
            .lineLimit(1)

            Spacer(minLength: 0)

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
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(ShellChrome.background)
        .overlay(alignment: .bottom) {
            Rectangle().fill(ShellChrome.border).frame(height: 1)
        }
    }

    private var brandLeading: String {
        let name = tripSession.tripDisplayName
        let parts = name.split(separator: " ")
        guard parts.count > 1 else { return name + " " }
        return parts.dropLast().joined(separator: " ") + " "
    }

    private var brandAccent: String {
        let parts = tripSession.tripDisplayName.split(separator: " ")
        return parts.count > 1 ? String(parts.last!) : ""
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
            ItineraryHomeView(session: tripSession)
        case .maps:
            MapsView(session: tripSession)
        case .draft:
            DraftView(session: tripSession)
        case .budget:
            BudgetView(session: tripSession)
        case .checklist:
            ChecklistView(session: tripSession)
        case .documents:
            DocumentsView(session: tripSession)
        case .photos:
            PhotoWallView(session: tripSession)
        case .settings:
            HandbookSettingsView(session: tripSession)
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
                    VStack(spacing: 4) {
                        ZStack {
                            if tripSession.activeTab == tab {
                                Circle()
                                    .fill(ShellChrome.accent)
                                    .frame(width: 42, height: 42)
                            }
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(
                                    tripSession.activeTab == tab
                                    ? Color(hex: "#0F0E0D")
                                    : ShellChrome.inkMuted
                                )
                        }
                        .frame(height: 42)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(shortTabLabel(tab))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(ShellChrome.cardBackground.opacity(0.96))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(ShellChrome.border, lineWidth: 1))
        .shadow(color: Color.black.opacity(ShellChrome.isDark ? 0.4 : 0.1), radius: 18, x: 0, y: 8)
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
                        Label(
                            theme.mode == .light ? "Dark theme" : "Light theme",
                            systemImage: theme.mode == .light ? "moon.fill" : "sun.max.fill"
                        )
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
                                Text(preview.id.label).font(.subheadline.weight(.semibold))
                                Text(preview.detail).font(.caption).foregroundStyle(ShellChrome.inkMuted)
                            }
                        }
                        .toggleStyle(SwitchToggleStyle(tint: ShellChrome.accent))
                        .disabled(!preview.isAvailable)
                    }

                    if let restoreMessage {
                        Text(restoreMessage).font(.footnote).foregroundStyle(ShellChrome.inkMuted)
                    }

                    PillButton(
                        title: isRestoreBusy ? "Restoring…" : "Restore",
                        kind: .primary,
                        isEnabled: !selectedRestoreIds.isEmpty && !isRestoreBusy
                    ) {
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
                    tripSession.restorePreview(userId: auth.user?.id).filter(\.isAvailable).map(\.id)
                )
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func bindingForRestore(_ id: RestoreDatasetId) -> Binding<Bool> {
        Binding(
            get: { selectedRestoreIds.contains(id) },
            set: { isOn in
                if isOn { selectedRestoreIds.insert(id) } else { selectedRestoreIds.remove(id) }
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
        LocalStore.saveShellTheme(shellThemeFromTripSettings(tripSession.tripSettings), userId: auth.user?.id)
    }

    private func syncTripTheme() {
        theme.applyTripSettings(tripSession.tripSettings)
    }
}
