import Foundation

enum LocalStore {
    static let hasVisitedKey = "hasVisited"
    static let exchangeRatesKey = "exchange-rates-v2"
    static let demoUserKey = "travel-handbook-demo-user"
    static let localAuthUsersKey = "travel-handbook-local-auth-users"
    static let localAuthSessionKey = "travel-handbook-local-auth-session"
    static let shellThemeKey = "shell-theme"
    static let selectedCurrencyKey = "selected-currency"
    static let checklistDataKey = "checklist-data"

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return encoder
    }()

    private static let decoder = JSONDecoder()

    static func itineraryKey(id: String) -> String { "itinerary-\(id)" }
    static func tripSettingsKey(id: String) -> String { "trip-settings-\(id)" }
    static func budgetKey(id: String) -> String { "budget-\(id)" }
    static func budgetMetaKey(id: String) -> String { "budget-meta-\(id)" }
    static func draftsKey(id: String) -> String { "drafts-\(id)" }
    static func tripIndexKey(ownerId: String) -> String { "travel-handbook-trip-index-\(ownerId)" }
    static func profileKey(userId: String) -> String { "profile-\(userId)" }
    static func shellThemeKey(userId: String) -> String { "shell-theme-\(userId)" }
    static func selectedCurrencyKey(userId: String) -> String { "selected-currency-\(userId)" }
    static func checklistDataKey(userId: String) -> String { "checklist-data-\(userId)" }
    static func themeKey(userId: String) -> String { ThemeManager.themeKey(for: userId) }

    static func getJSON<T: Decodable>(_ type: T.Type, key: String, userDefaults: UserDefaults = .standard) -> T? {
        guard let data = userDefaults.data(forKey: key) else {
            guard let raw = userDefaults.string(forKey: key),
                  let stringData = raw.data(using: .utf8) else {
                return nil
            }
            return try? decoder.decode(T.self, from: stringData)
        }
        return try? decoder.decode(T.self, from: data)
    }

    static func setJSON<T: Encodable>(_ value: T, key: String, userDefaults: UserDefaults = .standard) {
        guard let data = try? encoder.encode(value) else { return }
        userDefaults.set(data, forKey: key)
    }

    static func setString(_ value: String, key: String, userDefaults: UserDefaults = .standard) {
        userDefaults.set(value, forKey: key)
    }

    static func getString(key: String, userDefaults: UserDefaults = .standard) -> String? {
        userDefaults.string(forKey: key)
    }

    static func remove(key: String, userDefaults: UserDefaults = .standard) {
        userDefaults.removeObject(forKey: key)
    }

    static func hasVisited(userDefaults: UserDefaults = .standard) -> Bool {
        userDefaults.string(forKey: hasVisitedKey) != nil
    }

    static func markVisited(userDefaults: UserDefaults = .standard) {
        userDefaults.set("true", forKey: hasVisitedKey)
    }

    static func loadItinerary(id: String, userDefaults: UserDefaults = .standard) -> Itinerary? {
        getJSON(Itinerary.self, key: itineraryKey(id: id), userDefaults: userDefaults)
    }

    static func saveItinerary(_ itinerary: Itinerary, userDefaults: UserDefaults = .standard) {
        setJSON(itinerary, key: itineraryKey(id: itinerary.id), userDefaults: userDefaults)
    }

    static func loadTripSettings(tripId: String, userDefaults: UserDefaults = .standard) -> TripAppSettings {
        let stored = getJSON(TripAppSettings.self, key: tripSettingsKey(id: tripId), userDefaults: userDefaults)
        return mergeTripSettings(stored)
    }

    static func saveTripSettings(_ settings: TripAppSettings, tripId: String, userDefaults: UserDefaults = .standard) {
        setJSON(settings, key: tripSettingsKey(id: tripId), userDefaults: userDefaults)
    }

    static func loadBudget(tripId: String, userDefaults: UserDefaults = .standard) -> BudgetData? {
        getJSON(BudgetData.self, key: budgetKey(id: tripId), userDefaults: userDefaults)
    }

    static func saveBudget(_ budget: BudgetData, tripId: String, userDefaults: UserDefaults = .standard) {
        setJSON(budget, key: budgetKey(id: tripId), userDefaults: userDefaults)
        let meta = BudgetStorageMeta(updatedAt: ISO8601DateFormatter().string(from: Date()))
        setJSON(meta, key: budgetMetaKey(id: tripId), userDefaults: userDefaults)
    }

    static func loadBudgetMeta(tripId: String, userDefaults: UserDefaults = .standard) -> BudgetStorageMeta? {
        getJSON(BudgetStorageMeta.self, key: budgetMetaKey(id: tripId), userDefaults: userDefaults)
    }

    static func loadChecklist(userId: String?, userDefaults: UserDefaults = .standard) -> [ChecklistItem] {
        if let userId,
           let items = getJSON([ChecklistItem].self, key: checklistDataKey(userId: userId), userDefaults: userDefaults) {
            return items
        }
        return getJSON([ChecklistItem].self, key: checklistDataKey, userDefaults: userDefaults) ?? []
    }

    static func saveChecklist(_ items: [ChecklistItem], userId: String?, userDefaults: UserDefaults = .standard) {
        if let userId {
            setJSON(items, key: checklistDataKey(userId: userId), userDefaults: userDefaults)
        } else {
            setJSON(items, key: checklistDataKey, userDefaults: userDefaults)
        }
    }

    static func loadDrafts(tripId: String, userDefaults: UserDefaults = .standard) -> [DraftItem] {
        getJSON([DraftItem].self, key: draftsKey(id: tripId), userDefaults: userDefaults) ?? []
    }

    static func saveDrafts(_ drafts: [DraftItem], tripId: String, userDefaults: UserDefaults = .standard) {
        setJSON(drafts, key: draftsKey(id: tripId), userDefaults: userDefaults)
    }

    static func listLocalTrips(ownerId: String, userDefaults: UserDefaults = .standard) -> [LocalTripIndexEntry] {
        getJSON([LocalTripIndexEntry].self, key: tripIndexKey(ownerId: ownerId), userDefaults: userDefaults) ?? []
    }

    static func upsertLocalTrip(ownerId: String, itinerary: Itinerary, userDefaults: UserDefaults = .standard) {
        var entries = listLocalTrips(ownerId: ownerId, userDefaults: userDefaults)
            .filter { $0.id != itinerary.id }
        let entry = LocalTripIndexEntry(id: itinerary.id, updatedAt: ISO8601DateFormatter().string(from: Date()))
        entries.insert(entry, at: 0)
        setJSON(entries, key: tripIndexKey(ownerId: ownerId), userDefaults: userDefaults)
    }

    static func removeLocalTrip(ownerId: String, tripId: String, userDefaults: UserDefaults = .standard) {
        let entries = listLocalTrips(ownerId: ownerId, userDefaults: userDefaults)
            .filter { $0.id != tripId }
        setJSON(entries, key: tripIndexKey(ownerId: ownerId), userDefaults: userDefaults)
    }

    static func loadProfile(userId: String, userDefaults: UserDefaults = .standard) -> UserProfile {
        getJSON(UserProfile.self, key: profileKey(userId: userId), userDefaults: userDefaults) ?? .empty
    }

    static func saveProfile(_ profile: UserProfile, userId: String, userDefaults: UserDefaults = .standard) {
        setJSON(profile, key: profileKey(userId: userId), userDefaults: userDefaults)
    }

    static func loadShellTheme(userId: String?, userDefaults: UserDefaults = .standard) -> ShellThemePalettes {
        let keyed = userId.flatMap { getJSON(ShellThemePalettes.self, key: shellThemeKey(userId: $0), userDefaults: userDefaults) }
        let anonymous = getJSON(ShellThemePalettes.self, key: shellThemeKey, userDefaults: userDefaults)
        let parsed = keyed ?? anonymous
        guard let parsed else { return .default }
        return ShellThemePalettes(
            light: mergeThemeSettings(DEFAULT_LIGHT_THEME, parsed.light),
            dark: mergeThemeSettings(DEFAULT_DARK_THEME, parsed.dark)
        )
    }

    static func saveShellTheme(_ palettes: ShellThemePalettes, userId: String?, userDefaults: UserDefaults = .standard) {
        let next = ShellThemePalettes(
            light: mergeThemeSettings(DEFAULT_LIGHT_THEME, palettes.light),
            dark: mergeThemeSettings(DEFAULT_DARK_THEME, palettes.dark)
        )
        setJSON(next, key: shellThemeKey, userDefaults: userDefaults)
        if let userId {
            setJSON(next, key: shellThemeKey(userId: userId), userDefaults: userDefaults)
        }
    }

    static func loadSelectedCurrency(userId: String?, userDefaults: UserDefaults = .standard) -> String? {
        if let userId, let value = getString(key: selectedCurrencyKey(userId: userId), userDefaults: userDefaults) {
            return value
        }
        return getString(key: selectedCurrencyKey, userDefaults: userDefaults)
    }

    static func saveSelectedCurrency(_ code: String, userId: String?, userDefaults: UserDefaults = .standard) {
        setString(code, key: selectedCurrencyKey, userDefaults: userDefaults)
        if let userId {
            setString(code, key: selectedCurrencyKey(userId: userId), userDefaults: userDefaults)
        }
    }

    static func wipeTripLocalData(tripId: String, userDefaults: UserDefaults = .standard) {
        remove(key: itineraryKey(id: tripId), userDefaults: userDefaults)
        remove(key: tripSettingsKey(id: tripId), userDefaults: userDefaults)
        remove(key: budgetKey(id: tripId), userDefaults: userDefaults)
        remove(key: budgetMetaKey(id: tripId), userDefaults: userDefaults)
        remove(key: draftsKey(id: tripId), userDefaults: userDefaults)
        remove(key: "photos-\(tripId)", userDefaults: userDefaults)
        try? PhotoStore.shared.deleteAllPhotos(itineraryId: tripId)
    }
}
