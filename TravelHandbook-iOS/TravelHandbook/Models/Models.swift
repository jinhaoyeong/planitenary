import Foundation

// MARK: - Activity & itinerary

enum ActivityType: String, Codable, CaseIterable, Identifiable {
    case food, sight, culture, walk, nature, travel, flight, cafe, shop, nightlife, other

    var id: String { rawValue }
}

enum MoodReaction: String, Codable, CaseIterable {
    case see_first, must_go, maybe, skip, love, funny, surprised, pray
}

enum TravelerId: String, Codable, CaseIterable {
    case traveler1, traveler2
}

struct MoodVotes: Codable, Equatable {
    var traveler1: MoodReaction?
    var traveler2: MoodReaction?
    var comment: String?
    var commentBy: TravelerId?
}

struct VoiceNote: Codable, Equatable {
    var dataUrl: String
    var durationSec: Double
    var createdAt: String
}

struct Activity: Codable, Equatable, Identifiable {
    var id: String { "\(time)-\(name)" }
    var time: String
    var name: String
    var description: String
    var type: ActivityType
    var location: String?
    var cost: String?
    var rating: Double?
    var coordinates: [Double]?
    var moodVotes: MoodVotes?
    var voiceNote: VoiceNote?
}

struct DayPhoto: Codable, Equatable, Identifiable {
    var id: String
    var dataUrl: String
    var caption: String?
    var createdAt: String
}

struct DayPlan: Codable, Equatable, Identifiable {
    var id: Int { day }
    var day: Int
    var date: String
    var city: String
    var title: String
    var activities: [Activity]
    var photos: [DayPhoto]?
}

struct Itinerary: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var cities: [String]
    var description: String
    var days: [DayPlan]

    static func starter(id: String) -> Itinerary {
        Itinerary(
            id: id,
            name: "New Trip",
            cities: [],
            description: "Start with a blank travel handbook and shape every day your way.",
            days: [
                DayPlan(
                    day: 1,
                    date: "Add date",
                    city: "Add city",
                    title: "Plan your first day",
                    activities: [],
                    photos: nil
                )
            ]
        )
    }
}

// MARK: - Drafts

struct DraftItem: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var link: String
    var note: String
    var day: Int
    var time: String
    var type: ActivityType
    var isRedNote: Bool?
    var previewTitle: String?
    var previewText: String?
    var thumbnailUrl: String?
    var screenshotUrls: [String]?
    var updatedAt: String?
}

// MARK: - Budget

enum BudgetCategory: String, Codable, CaseIterable, Identifiable {
    case flights, accommodation, transportation, food, activities, misc

    var id: String { rawValue }
}

struct BudgetItem: Codable, Equatable, Identifiable {
    var id: String
    var label: String
    var cost: String
}

struct BudgetCategoryData: Codable, Equatable {
    var min: Double
    var max: Double
    var items: [BudgetItem]

    init(min: Double, max: Double, items: [BudgetItem]) {
        self.min = min
        self.max = max
        self.items = items
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        min = try Self.decodeFlexibleNumber(container, forKey: .min)
        max = try Self.decodeFlexibleNumber(container, forKey: .max)
        items = try container.decodeIfPresent([BudgetItem].self, forKey: .items) ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case min, max, items
    }

    private static func decodeFlexibleNumber(
        _ container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) throws -> Double {
        if let value = try? container.decode(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decode(Int.self, forKey: key) {
            return Double(value)
        }
        return 0
    }
}

struct BudgetData: Codable, Equatable {
    var flights: BudgetCategoryData
    var accommodation: BudgetCategoryData
    var transportation: BudgetCategoryData
    var food: BudgetCategoryData
    var activities: BudgetCategoryData
    var misc: BudgetCategoryData
    var expenses: [Expense]

    subscript(category: BudgetCategory) -> BudgetCategoryData {
        get {
            switch category {
            case .flights: return flights
            case .accommodation: return accommodation
            case .transportation: return transportation
            case .food: return food
            case .activities: return activities
            case .misc: return misc
            }
        }
        set {
            switch category {
            case .flights: flights = newValue
            case .accommodation: accommodation = newValue
            case .transportation: transportation = newValue
            case .food: food = newValue
            case .activities: activities = newValue
            case .misc: misc = newValue
            }
        }
    }

    var categories: [BudgetCategory: BudgetCategoryData] {
        get {
            Dictionary(uniqueKeysWithValues: BudgetCategory.allCases.map { ($0, self[$0]) })
        }
        set {
            for (key, value) in newValue {
                self[key] = value
            }
        }
    }

    static var empty: BudgetData {
        let emptyCategory = BudgetCategoryData(min: 0, max: 0, items: [])
        return BudgetData(
            flights: emptyCategory,
            accommodation: emptyCategory,
            transportation: emptyCategory,
            food: emptyCategory,
            activities: emptyCategory,
            misc: emptyCategory,
            expenses: []
        )
    }

    init(
        flights: BudgetCategoryData,
        accommodation: BudgetCategoryData,
        transportation: BudgetCategoryData,
        food: BudgetCategoryData,
        activities: BudgetCategoryData,
        misc: BudgetCategoryData,
        expenses: [Expense]
    ) {
        self.flights = flights
        self.accommodation = accommodation
        self.transportation = transportation
        self.food = food
        self.activities = activities
        self.misc = misc
        self.expenses = expenses
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        flights = try container.decodeIfPresent(BudgetCategoryData.self, forKey: .flights)
            ?? BudgetCategoryData(min: 0, max: 0, items: [])
        accommodation = try container.decodeIfPresent(BudgetCategoryData.self, forKey: .accommodation)
            ?? BudgetCategoryData(min: 0, max: 0, items: [])
        transportation = try container.decodeIfPresent(BudgetCategoryData.self, forKey: .transportation)
            ?? BudgetCategoryData(min: 0, max: 0, items: [])
        food = try container.decodeIfPresent(BudgetCategoryData.self, forKey: .food)
            ?? BudgetCategoryData(min: 0, max: 0, items: [])
        activities = try container.decodeIfPresent(BudgetCategoryData.self, forKey: .activities)
            ?? BudgetCategoryData(min: 0, max: 0, items: [])
        misc = try container.decodeIfPresent(BudgetCategoryData.self, forKey: .misc)
            ?? BudgetCategoryData(min: 0, max: 0, items: [])
        expenses = try container.decodeIfPresent([Expense].self, forKey: .expenses) ?? []
    }
}

struct BudgetStorageMeta: Codable, Equatable {
    var updatedAt: String
}

enum ExpensePaidBy: String, Codable {
    case traveler1 = "Traveler 1"
    case traveler2 = "Traveler 2"
}

struct Expense: Codable, Equatable, Identifiable {
    var id: String
    var description: String
    var amount: Double
    var paidBy: ExpensePaidBy
    var category: String
    var date: String

    private enum CodingKeys: String, CodingKey {
        case id, description, amount, paidBy, category, date
        case amountMYR, amountCNY
    }

    init(
        id: String,
        description: String,
        amount: Double,
        paidBy: ExpensePaidBy,
        category: String,
        date: String
    ) {
        self.id = id
        self.description = description
        self.amount = amount
        self.paidBy = paidBy
        self.category = category
        self.date = date
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        description = try container.decode(String.self, forKey: .description)
        if let explicit = try container.decodeIfPresent(Double.self, forKey: .amount) {
            amount = explicit
        } else if let myr = try container.decodeIfPresent(Double.self, forKey: .amountMYR) {
            amount = myr
        } else if let cny = try container.decodeIfPresent(Double.self, forKey: .amountCNY) {
            amount = cny
        } else {
            amount = 0
        }
        paidBy = try container.decode(ExpensePaidBy.self, forKey: .paidBy)
        category = try container.decode(String.self, forKey: .category)
        date = try container.decode(String.self, forKey: .date)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(description, forKey: .description)
        try container.encode(amount, forKey: .amount)
        try container.encode(paidBy, forKey: .paidBy)
        try container.encode(category, forKey: .category)
        try container.encode(date, forKey: .date)
    }
}

// MARK: - Checklist

enum ChecklistCategory: String, Codable, CaseIterable, Identifiable {
    case packing = "Packing"
    case pretrip = "Pre-trip"
    case daily = "Daily"

    var id: String { rawValue }
}

struct ChecklistItem: Codable, Equatable, Identifiable {
    var id: String
    var text: String
    var category: ChecklistCategory
    var completed: Bool
    var isCustom: Bool?

    init(
        id: String,
        text: String,
        category: ChecklistCategory,
        completed: Bool,
        isCustom: Bool? = nil
    ) {
        self.id = id
        self.text = text
        self.category = category
        self.completed = completed
        self.isCustom = isCustom
    }
}

// MARK: - Documents

struct DocumentFile: Codable, Equatable, Identifiable {
    var id: String { path }
    var path: String
    var name: String
    var type: String
}

struct TripDocument: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var description: String
    var category: String
    var files: [DocumentFile]
    var createdAt: String
    var updatedAt: String

    private enum CodingKeys: String, CodingKey {
        case id, title, description, category, files
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case storagePath = "storage_path"
        case fileName = "file_name"
        case mimeType = "mime_type"
    }

    init(
        id: String,
        title: String,
        description: String,
        category: String,
        files: [DocumentFile],
        createdAt: String,
        updatedAt: String
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.category = category
        self.files = files
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description) ?? ""
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt) ?? ""
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""

        if let decodedFiles = try container.decodeIfPresent([DocumentFile].self, forKey: .files) {
            category = try container.decodeIfPresent(String.self, forKey: .category) ?? "General"
            files = decodedFiles
            return
        }

        let storagePath = try container.decodeIfPresent(String.self, forKey: .storagePath) ?? ""
        let fileName = try container.decodeIfPresent(String.self, forKey: .fileName) ?? ""
        let mimeType = try container.decodeIfPresent(String.self, forKey: .mimeType) ?? ""

        var parsedCategory = "General"
        var parsedFiles: [DocumentFile] = []

        if storagePath.hasPrefix("{"),
           let data = storagePath.data(using: .utf8),
           let json = try? JSONDecoder().decode(DocumentPayload.self, from: data) {
            parsedCategory = json.category ?? "General"
            parsedFiles = json.files ?? []
        } else if storagePath.hasPrefix("["),
                  let data = storagePath.data(using: .utf8),
                  let json = try? JSONDecoder().decode([DocumentFile].self, from: data) {
            parsedFiles = json
        }

        if parsedFiles.isEmpty, !storagePath.isEmpty, !storagePath.hasPrefix("{"), !storagePath.hasPrefix("[") {
            parsedFiles = [DocumentFile(path: storagePath, name: fileName, type: mimeType)]
        }

        category = parsedCategory
        files = parsedFiles
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(title, forKey: .title)
        try container.encode(description, forKey: .description)
        try container.encode(category, forKey: .category)
        try container.encode(files, forKey: .files)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encode(updatedAt, forKey: .updatedAt)
    }

    private struct DocumentPayload: Codable {
        var category: String?
        var files: [DocumentFile]?
    }
}

// MARK: - Dashboard & profile

struct TripItem: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var cities: [String]
    var days: Int
    var updatedAt: String

    private enum CodingKeys: String, CodingKey {
        case id, name, cities, days
        case updatedAt
        case updatedAtSnake = "updated_at"
    }

    init(id: String, name: String, cities: [String], days: Int, updatedAt: String) {
        self.id = id
        self.name = name
        self.cities = cities
        self.days = days
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        cities = try container.decodeIfPresent([String].self, forKey: .cities) ?? []
        days = try container.decodeIfPresent(Int.self, forKey: .days) ?? 0
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
            ?? container.decodeIfPresent(String.self, forKey: .updatedAtSnake)
            ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode(name, forKey: .name)
        try container.encode(cities, forKey: .cities)
        try container.encode(days, forKey: .days)
        try container.encode(updatedAt, forKey: .updatedAt)
    }
}

struct UserProfile: Codable, Equatable {
    var displayName: String
    var fullName: String
    var location: String
    var bio: String
    var avatarDataURL: String?
    var email: String

    private enum CodingKeys: String, CodingKey {
        case displayName, fullName, location, bio, email
        case avatarDataURL
        case avatarImage
    }

    static let empty = UserProfile(
        displayName: "",
        fullName: "",
        location: "",
        bio: "",
        avatarDataURL: nil,
        email: ""
    )

    init(
        displayName: String,
        fullName: String,
        location: String,
        bio: String,
        avatarDataURL: String?,
        email: String
    ) {
        self.displayName = displayName
        self.fullName = fullName
        self.location = location
        self.bio = bio
        self.avatarDataURL = avatarDataURL
        self.email = email
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        displayName = try container.decodeIfPresent(String.self, forKey: .displayName) ?? ""
        fullName = try container.decodeIfPresent(String.self, forKey: .fullName) ?? ""
        location = try container.decodeIfPresent(String.self, forKey: .location) ?? ""
        bio = try container.decodeIfPresent(String.self, forKey: .bio) ?? ""
        email = try container.decodeIfPresent(String.self, forKey: .email) ?? ""
        avatarDataURL = try container.decodeIfPresent(String.self, forKey: .avatarDataURL)
            ?? container.decodeIfPresent(String.self, forKey: .avatarImage)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(fullName, forKey: .fullName)
        try container.encode(location, forKey: .location)
        try container.encode(bio, forKey: .bio)
        try container.encode(email, forKey: .email)
        try container.encodeIfPresent(avatarDataURL, forKey: .avatarDataURL)
    }
}

struct LocalTripIndexEntry: Codable, Equatable, Identifiable {
    var id: String
    var updatedAt: String
}
