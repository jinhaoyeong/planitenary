import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var theme: ThemeManager
    @ObservedObject var tripSession: TripSession

    @State private var trips: [TripItem] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var page = 0
    @State private var hasMore = false
    @State private var isLoadingMore = false

    @State private var tripPendingDelete: TripItem?
    @State private var tripPendingRename: TripItem?
    @State private var renameDraft = ""

    private let pageSize = 10

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                startNewTripCard

                if isLoading, trips.isEmpty {
                    ProgressView("Loading trips…")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 40)
                } else if let errorMessage, trips.isEmpty {
                    EmptyState(
                        systemImage: "exclamationmark.triangle",
                        title: "Could not load trips",
                        message: errorMessage,
                        actionTitle: "Try again",
                        action: { Task { await reloadTrips() } }
                    )
                } else if trips.isEmpty {
                    EmptyState(
                        systemImage: "suitcase",
                        title: "No trips yet",
                        message: "Start a new handbook to plan cities, days, budgets, and memories in one place.",
                        actionTitle: "Start New Trip",
                        action: startNewTrip
                    )
                } else {
                    VStack(spacing: 14) {
                        ForEach(trips) { trip in
                            tripCard(trip)
                        }
                    }

                    if showsCloudPagination, hasMore {
                        PillButton(
                            title: isLoadingMore ? "Loading…" : "Load More",
                            systemImage: "arrow.down.circle",
                            kind: .ghost,
                            isEnabled: !isLoadingMore,
                            action: loadMore
                        )
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 32)
        }
        .background(ShellChrome.background.ignoresSafeArea())
        .handbookTheme(theme)
        .onAppear {
            theme.applyTripSettings(nil)
            theme.applyShellPalette(userId: auth.user?.id)
        }
        .task(id: auth.user?.id) {
            await reloadTrips()
        }
        .confirmationDialog(
            "Delete this trip?",
            isPresented: Binding(
                get: { tripPendingDelete != nil },
                set: { if !$0 { tripPendingDelete = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button("Delete Trip", role: .destructive) {
                if let trip = tripPendingDelete {
                    Task { await deleteTrip(trip) }
                }
                tripPendingDelete = nil
            }
            Button("Cancel", role: .cancel) { tripPendingDelete = nil }
        } message: {
            Text("This removes the trip from your dashboard and clears local budget and draft data.")
        }
        .alert("Rename trip", isPresented: Binding(
            get: { tripPendingRename != nil },
            set: { if !$0 { tripPendingRename = nil } }
        )) {
            TextField("Trip name", text: $renameDraft)
            Button("Save") {
                if let trip = tripPendingRename {
                    Task { await renameTrip(trip, to: renameDraft) }
                }
                tripPendingRename = nil
            }
            Button("Cancel", role: .cancel) { tripPendingRename = nil }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Your Dashboard")
                .font(.system(size: 40, weight: .regular, design: .serif))
                .foregroundStyle(ShellChrome.ink)

            Text(accountSubtitle)
                .font(.subheadline)
                .foregroundStyle(ShellChrome.inkMuted)

            Button {
                Task { await auth.signOut() }
            } label: {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ShellChrome.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(ShellChrome.accentSoft)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            .buttonStyle(.plain)

            HStack {
                Spacer()
                Button {
                    theme.toggleTheme()
                } label: {
                    Image(systemName: theme.mode == .dark ? "sun.max.fill" : "moon.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(ShellChrome.inkMuted)
                }
                .buttonStyle(.plain)
            }

            Rectangle()
                .fill(ShellChrome.border)
                .frame(height: 1)
                .padding(.top, 4)
        }
    }

    private var startNewTripCard: some View {
        Button(action: startNewTrip) {
            VStack(spacing: 14) {
                Image(systemName: "plus")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(ShellChrome.accent)
                    .frame(width: 56, height: 56)
                    .background(ShellChrome.accentSoft, in: Circle())

                Text("Start New Trip")
                    .font(.system(size: 28, weight: .regular, design: .serif))
                    .foregroundStyle(ShellChrome.ink)

                Text("Create a blank canvas")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 36)
            .padding(.horizontal, 20)
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(style: StrokeStyle(lineWidth: 1.5, dash: [7, 6]))
                    .foregroundStyle(ShellChrome.border)
            )
        }
        .buttonStyle(.plain)
    }

    private func tripCard(_ trip: TripItem) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("\(trip.days) days")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(ShellChrome.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(ShellChrome.accentSoft)
                    .clipShape(Capsule())
                Spacer()
                Menu {
                    Button("Edit name") {
                        tripPendingRename = trip
                        renameDraft = trip.name
                    }
                    Button("Delete", role: .destructive) {
                        tripPendingDelete = trip
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(ShellChrome.inkMuted)
                }
            }

            Button {
                openTrip(trip.id)
            } label: {
                VStack(alignment: .leading, spacing: 6) {
                    Text(trip.name)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(ShellChrome.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text(trip.cities.isEmpty ? "No cities yet" : trip.cities.joined(separator: " · "))
                        .font(.subheadline)
                        .foregroundStyle(ShellChrome.inkMuted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("Updated \(formattedUpdatedAt(trip.updatedAt))")
                        .font(.caption)
                        .foregroundStyle(ShellChrome.inkMuted.opacity(0.85))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .shellCard()
    }

    private var accountSubtitle: String {
        if auth.isDemoUser { return "Demo account" }
        if auth.isLocalTestUser { return "Local account on this device" }
        if auth.user != nil { return "Cloud account" }
        return "Not signed in"
    }

    private var showsCloudPagination: Bool {
        auth.user != nil && !auth.skipsCloudGates && SupabaseClient.shared.isConfigured
    }

    private func formattedUpdatedAt(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: iso) else { return iso }
        return date.formatted(date: .abbreviated, time: .shortened)
    }

    private func openTrip(_ id: String) {
        tripSession.itineraryOwnerHint = auth.user?.id
        tripSession.openTrip(id: id)
    }

    private func startNewTrip() {
        guard let user = auth.user else { return }
        let newId = "trip-\(Int(Date().timeIntervalSince1970 * 1000))"
        let starter = Itinerary.starter(id: newId)
        LocalStore.saveItinerary(starter)
        LocalStore.upsertLocalTrip(ownerId: user.id, itinerary: starter)
        Task {
            if showsCloudPagination {
                await upsertCloudTrip(starter, userId: user.id)
            }
        }
        openTrip(newId)
    }

    @MainActor
    private func reloadTrips() async {
        page = 0
        await loadTrips(page: 0, append: false)
    }

    @MainActor
    private func loadMore() {
        guard !isLoadingMore else { return }
        isLoadingMore = true
        let nextPage = page + 1
        Task {
            await loadTrips(page: nextPage, append: true)
            page = nextPage
            isLoadingMore = false
        }
    }

    @MainActor
    private func loadTrips(page: Int, append: Bool) async {
        guard let user = auth.user else {
            trips = []
            hasMore = false
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        if auth.skipsCloudGates || !SupabaseClient.shared.isConfigured {
            trips = localTrips(ownerId: user.id)
            hasMore = false
            return
        }

        do {
            let from = page * pageSize
            let to = from + pageSize - 1
            let (rows, total): ([CloudItineraryRow], Int?) = try await SupabaseClient.shared
                .from("itineraries")
                .select("id,data,updated_at")
                .eq("user_id", value: user.id)
                .order("updated_at", ascending: false)
                .range(from: from, to: to)
                .preferCountExact()
                .decodeRowsWithCount([CloudItineraryRow].self)

            let mapped = rows.map { $0.asTripItem }
            trips = append ? trips + mapped : mapped
            if let total {
                hasMore = total > (page + 1) * pageSize
            } else {
                hasMore = mapped.count >= pageSize
            }
        } catch {
            errorMessage = error.localizedDescription
            if !append {
                trips = localTrips(ownerId: user.id)
            }
            hasMore = false
        }
    }

    private func localTrips(ownerId: String) -> [TripItem] {
        LocalStore.listLocalTrips(ownerId: ownerId).compactMap { entry in
            guard let itinerary = LocalStore.loadItinerary(id: entry.id) else { return nil }
            return TripItem(
                id: entry.id,
                name: itinerary.name.isEmpty ? "Untitled Trip" : itinerary.name,
                cities: itinerary.cities,
                days: itinerary.days.count,
                updatedAt: entry.updatedAt
            )
        }
    }

    @MainActor
    private func deleteTrip(_ trip: TripItem) async {
        guard let user = auth.user else { return }

        if showsCloudPagination {
            _ = try? await SupabaseClient.shared.from("itineraries").delete().eq("id", value: trip.id).execute()
            _ = try? await SupabaseClient.shared.from("budgets").delete().eq("id", value: trip.id).execute()
            _ = try? await SupabaseClient.shared.from("draft_items").delete().eq("itinerary_id", value: trip.id).execute()
        }

        LocalStore.wipeTripLocalData(tripId: trip.id)
        LocalStore.removeLocalTrip(ownerId: user.id, tripId: trip.id)
        trips.removeAll { $0.id == trip.id }

        if tripSession.activeItineraryId == trip.id {
            tripSession.closeTrip()
        }
    }

    @MainActor
    private func renameTrip(_ trip: TripItem, to name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let user = auth.user else { return }

        if var itinerary = LocalStore.loadItinerary(id: trip.id) {
            itinerary.name = trimmed
            LocalStore.saveItinerary(itinerary)
            LocalStore.upsertLocalTrip(ownerId: user.id, itinerary: itinerary)
            if showsCloudPagination {
                await upsertCloudTrip(itinerary, userId: user.id)
            }
        }

        if let index = trips.firstIndex(where: { $0.id == trip.id }) {
            let existing = trips[index]
            trips[index] = TripItem(
                id: existing.id,
                name: trimmed,
                cities: existing.cities,
                days: existing.days,
                updatedAt: ISO8601DateFormatter().string(from: Date())
            )
        }

        if tripSession.activeItineraryId == trip.id {
            tripSession.renameTrip(to: trimmed)
        }
    }

    private func upsertCloudTrip(_ itinerary: Itinerary, userId: String) async {
        guard SupabaseClient.shared.isConfigured else { return }
        guard let data = try? JSONEncoder.supabase.encode(itinerary),
              let json = try? JSONDecoder.supabase.decode(JSONAny.self, from: data) else { return }

        let row: [String: JSONAny] = [
            "id": .string(itinerary.id),
            "user_id": .string(userId),
            "data": json,
            "updated_at": .string(ISO8601DateFormatter().string(from: Date())),
        ]
        _ = try? await SupabaseClient.shared.from("itineraries").upsert(row, onConflict: "id").execute()
    }
}

private struct CloudItineraryRow: Decodable {
    let id: String
    let data: Itinerary?
    let updatedAt: String?

    enum CodingKeys: String, CodingKey {
        case id, data
        case updatedAt = "updated_at"
    }

    var asTripItem: TripItem {
        TripItem(
            id: id,
            name: data?.name.isEmpty == false ? data!.name : "Untitled Trip",
            cities: data?.cities ?? [],
            days: data?.days.count ?? 0,
            updatedAt: updatedAt ?? ISO8601DateFormatter().string(from: Date())
        )
    }
}
