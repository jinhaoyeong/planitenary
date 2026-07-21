import Foundation
import SwiftUI

enum TripTab: String, CaseIterable, Identifiable {
    case itinerary
    case maps
    case draft
    case budget
    case checklist
    case documents
    case photos
    case settings
    case account

    var id: String { rawValue }

    var title: String {
        switch self {
        case .itinerary: return "Itinerary"
        case .maps: return "Maps"
        case .draft: return "Draft"
        case .budget: return "Budget"
        case .checklist: return "Checklist"
        case .documents: return "Documents"
        case .photos: return "Photos"
        case .settings: return "Handbook Settings"
        case .account: return "Account"
        }
    }

    var systemImage: String {
        switch self {
        case .itinerary: return "calendar"
        case .maps: return "map"
        case .draft: return "book"
        case .budget: return "wallet.pass"
        case .checklist: return "checkmark.square"
        case .documents: return "doc.text"
        case .photos: return "photo.on.rectangle"
        case .settings: return "slider.horizontal.3"
        case .account: return "person.crop.circle"
        }
    }

    var showsInPrimaryPillBar: Bool {
        switch self {
        case .itinerary, .maps, .draft, .budget, .checklist:
            return true
        default:
            return false
        }
    }

    static var primaryPillTabs: [TripTab] {
        allCases.filter(\.showsInPrimaryPillBar)
    }
}

enum RestoreDatasetId: String, CaseIterable, Identifiable {
    case itinerary
    case budget
    case checklist
    case drafts
    case photos

    var id: String { rawValue }

    var label: String {
        switch self {
        case .itinerary: return "Itinerary"
        case .budget: return "Budget"
        case .checklist: return "Checklist"
        case .drafts: return "Draft Ideas"
        case .photos: return "Photos"
        }
    }
}

struct RestoreDatasetPreview: Identifiable {
    let id: RestoreDatasetId
    let isAvailable: Bool
    let detail: String
}

@MainActor
final class TripSession: ObservableObject {
    @Published var activeItineraryId: String?
    @Published var itinerary: Itinerary?
    @Published var tripSettings: TripAppSettings = DEFAULT_TRIP_SETTINGS
    @Published var activeTab: TripTab = .itinerary

    private var restoreSnapshotKey: String {
        guard let activeItineraryId else { return "restore-snapshot-none" }
        return "restore-snapshot-\(activeItineraryId)"
    }

    func openTrip(id: String) {
        activeItineraryId = id
        activeTab = .itinerary
        loadTripData()
    }

    func closeTrip() {
        saveTripData()
        activeItineraryId = nil
        itinerary = nil
        tripSettings = DEFAULT_TRIP_SETTINGS
        activeTab = .itinerary
    }

    func loadTripData() {
        guard let id = activeItineraryId else { return }
        if let stored = LocalStore.loadItinerary(id: id) {
            itinerary = stored
        } else {
            itinerary = createStarter(id: id)
            saveItinerary()
        }
        tripSettings = LocalStore.loadTripSettings(tripId: id)
    }

    func saveTripData() {
        saveItinerary()
        saveTripSettings()
    }

    func saveItinerary() {
        guard let itinerary else { return }
        LocalStore.saveItinerary(itinerary)
        if let ownerId = itineraryOwnerHint {
            LocalStore.upsertLocalTrip(ownerId: ownerId, itinerary: itinerary)
        }
    }

    func saveTripSettings() {
        guard let id = activeItineraryId else { return }
        LocalStore.saveTripSettings(tripSettings, tripId: id)
    }

    func createStarter(id: String) -> Itinerary {
        Itinerary.starter(id: id)
    }

    func updateItinerary(_ transform: (inout Itinerary) -> Void) {
        guard var current = itinerary else { return }
        transform(&current)
        itinerary = current
        saveItinerary()
    }

    func renameTrip(to name: String) {
        updateItinerary { $0.name = name.trimmingCharacters(in: .whitespacesAndNewlines) }
    }

    var tripDisplayName: String {
        itinerary?.name ?? "Untitled Trip"
    }

    /// Set by shell when user context is known (dashboard / trip open).
    var itineraryOwnerHint: String?

    // MARK: - Cloud sync stubs

    func refreshItineraryFromCloud(auth: AuthViewModel) async {
        guard let id = activeItineraryId,
              let user = auth.user,
              !auth.skipsCloudGates,
              SupabaseClient.shared.isConfigured else { return }

        do {
            let row = try await SupabaseClient.shared
                .from("itineraries")
                .select("data")
                .eq("id", value: id)
                .eq("user_id", value: user.id)
                .maybeSingle()
            if let data = row?["data"], let remote = decodeItinerary(from: data) {
                itinerary = remote
                LocalStore.saveItinerary(remote)
            }
        } catch {
            // Keep local copy when cloud refresh fails.
        }
    }

    func syncItineraryToCloud(auth: AuthViewModel) async {
        guard let id = activeItineraryId,
              let itinerary,
              let user = auth.user,
              !auth.skipsCloudGates,
              SupabaseClient.shared.isConfigured else { return }

        let payload: [String: JSONAny] = [
            "id": .string(id),
            "user_id": .string(user.id),
            "data": encodeItineraryJSON(itinerary),
            "updated_at": .string(ISO8601DateFormatter().string(from: Date())),
        ]

        _ = try? await SupabaseClient.shared
            .from("itineraries")
            .upsert(payload, onConflict: "id")
            .execute()
    }

    func backupTripToCloud(auth: AuthViewModel) async -> Bool {
        await syncItineraryToCloud(auth: auth)
        return SupabaseClient.shared.isConfigured && !auth.skipsCloudGates
    }

    // MARK: - Restore helpers

    func restorePreview(userId: String?) -> [RestoreDatasetPreview] {
        guard let id = activeItineraryId else { return [] }
        return RestoreDatasetId.allCases.map { dataset in
            let key = storageKey(for: dataset, tripId: id, userId: userId)
            let available = hasRestoreCandidate(for: key) || hasPrimaryData(for: dataset, tripId: id, userId: userId)
            return RestoreDatasetPreview(
                id: dataset,
                isAvailable: available,
                detail: available ? "Backup or history available" : "No backup found"
            )
        }
    }

    func restoreSelected(_ datasets: [RestoreDatasetId], userId: String?) -> Int {
        guard let id = activeItineraryId else { return 0 }
        createRestoreSnapshot(userId: userId)
        var restored = 0
        for dataset in datasets {
            let key = storageKey(for: dataset, tripId: id, userId: userId)
            if restoreKey(key, tripId: id, userId: userId, dataset: dataset) {
                restored += 1
            }
        }
        loadTripData()
        return restored
    }

    var hasUndoRestoreSnapshot: Bool {
        LocalStore.getJSON(RestoreSnapshot.self, key: restoreSnapshotKey) != nil
    }

    func undoLastRestore(userId: String?) -> Bool {
        guard let snapshot = LocalStore.getJSON(RestoreSnapshot.self, key: restoreSnapshotKey),
              let id = activeItineraryId else { return false }
        applySnapshot(snapshot, tripId: id, userId: userId)
        LocalStore.remove(key: restoreSnapshotKey)
        loadTripData()
        return true
    }

    private func storageKey(for dataset: RestoreDatasetId, tripId: String, userId: String?) -> String {
        switch dataset {
        case .itinerary: return LocalStore.itineraryKey(id: tripId)
        case .budget: return LocalStore.budgetKey(id: tripId)
        case .checklist:
            if let userId { return LocalStore.checklistDataKey(userId: userId) }
            return LocalStore.checklistDataKey
        case .drafts: return LocalStore.draftsKey(id: tripId)
        case .photos: return "photos-\(tripId)"
        }
    }

    private func hasPrimaryData(for dataset: RestoreDatasetId, tripId: String, userId: String?) -> Bool {
        switch dataset {
        case .itinerary: return LocalStore.loadItinerary(id: tripId) != nil
        case .budget: return LocalStore.loadBudget(tripId: tripId) != nil
        case .checklist: return !LocalStore.loadChecklist(userId: userId).isEmpty
        case .drafts: return !LocalStore.loadDrafts(tripId: tripId).isEmpty
        case .photos: return !(PhotoStore.shared.loadAllPhotos(itineraryId: tripId).isEmpty)
        }
    }

    private func hasRestoreCandidate(for key: String) -> Bool {
        UserDefaults.standard.data(forKey: "\(key)-backup") != nil
            || UserDefaults.standard.string(forKey: "\(key)-backup") != nil
    }

    private func restoreKey(_ key: String, tripId: String, userId: String?, dataset: RestoreDatasetId) -> Bool {
        guard let raw = UserDefaults.standard.string(forKey: "\(key)-backup")
            ?? UserDefaults.standard.data(forKey: "\(key)-backup").flatMap({ String(data: $0, encoding: .utf8) }) else {
            return false
        }
        UserDefaults.standard.set(raw, forKey: key)
        switch dataset {
        case .photos:
            _ = PhotoStore.shared.restorePhotos(for: tripId)
            return true
        default:
            return true
        }
    }

    private struct RestoreSnapshot: Codable {
        var itineraryRaw: String?
        var budgetRaw: String?
        var checklistRaw: String?
        var draftsRaw: String?
    }

    private func createRestoreSnapshot(userId: String?) {
        guard let id = activeItineraryId else { return }
        let snapshot = RestoreSnapshot(
            itineraryRaw: rawString(for: LocalStore.itineraryKey(id: id)),
            budgetRaw: rawString(for: LocalStore.budgetKey(id: id)),
            checklistRaw: rawString(for: userId.map { LocalStore.checklistDataKey(userId: $0) } ?? LocalStore.checklistDataKey),
            draftsRaw: rawString(for: LocalStore.draftsKey(id: id))
        )
        LocalStore.setJSON(snapshot, key: restoreSnapshotKey)
    }

    private func applySnapshot(_ snapshot: RestoreSnapshot, tripId: String, userId: String?) {
        if let raw = snapshot.itineraryRaw {
            UserDefaults.standard.set(raw, forKey: LocalStore.itineraryKey(id: tripId))
        }
        if let raw = snapshot.budgetRaw {
            UserDefaults.standard.set(raw, forKey: LocalStore.budgetKey(id: tripId))
        }
        if let raw = snapshot.checklistRaw {
            let checklistKey = userId.map { LocalStore.checklistDataKey(userId: $0) } ?? LocalStore.checklistDataKey
            UserDefaults.standard.set(raw, forKey: checklistKey)
        }
        if let raw = snapshot.draftsRaw {
            UserDefaults.standard.set(raw, forKey: LocalStore.draftsKey(id: tripId))
        }
    }

    private func rawString(for key: String) -> String? {
        if let data = UserDefaults.standard.data(forKey: key) {
            return String(data: data, encoding: .utf8)
        }
        return UserDefaults.standard.string(forKey: key)
    }

    private func encodeItineraryJSON(_ itinerary: Itinerary) -> JSONAny {
        guard let data = try? JSONEncoder.supabase.encode(itinerary),
              let decoded = try? JSONDecoder.supabase.decode(JSONAny.self, from: data) else {
            return .null
        }
        return decoded
    }

    private func decodeItinerary(from value: JSONAny) -> Itinerary? {
        guard let data = try? JSONEncoder.supabase.encode(value) else { return nil }
        return try? JSONDecoder.supabase.decode(Itinerary.self, from: data)
    }
}
