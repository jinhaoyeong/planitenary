import SwiftUI

extension ActivityType {
    var label: String {
        rawValue.capitalized
    }

    var systemImage: String {
        switch self {
        case .food: return "fork.knife"
        case .sight: return "binoculars.fill"
        case .culture: return "building.columns.fill"
        case .walk: return "figure.walk"
        case .nature: return "leaf.fill"
        case .travel: return "car.fill"
        case .flight: return "airplane"
        case .cafe: return "cup.and.saucer.fill"
        case .shop: return "bag.fill"
        case .nightlife: return "moon.stars.fill"
        case .other: return "sparkles"
        }
    }
}

extension MoodReaction {
    var label: String {
        switch self {
        case .see_first: return "See first"
        case .must_go: return "Must go"
        case .maybe: return "Maybe"
        case .skip: return "Skip"
        case .love: return "Love"
        case .funny: return "Funny"
        case .surprised: return "Surprised"
        case .pray: return "Pray"
        }
    }

    var emoji: String {
        switch self {
        case .see_first: return "👀"
        case .must_go: return "⭐"
        case .maybe: return "🤔"
        case .skip: return "⏭️"
        case .love: return "❤️"
        case .funny: return "😂"
        case .surprised: return "😮"
        case .pray: return "🙏"
        }
    }
}

enum FoodGems {
    struct Entry: Identifiable {
        let id = UUID()
        let name: String
        let blurb: String
    }

    static func picks(for city: String, mode: FoodPickerMode) -> [Entry] {
        let key = city.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let local = localGems[key] ?? genericLocal
        let mustTry = mustTryGems[key] ?? genericMustTry
        return mode == .local ? local : mustTry
    }

    enum FoodPickerMode: String, CaseIterable, Identifiable {
        case local, must_try

        var id: String { rawValue }

        var label: String {
            switch self {
            case .local: return "Local gems"
            case .must_try: return "Must try"
            }
        }
    }

    private static let genericLocal: [Entry] = [
        Entry(name: "Night market snacks", blurb: "Follow the smoke and the longest queue."),
        Entry(name: "Corner noodle shop", blurb: "Plastic stools, loud slurps, zero regrets."),
        Entry(name: "Family-run breakfast", blurb: "Whatever the regulars order."),
    ]

    private static let genericMustTry: [Entry] = [
        Entry(name: "Signature street dish", blurb: "The one everyone posts about."),
        Entry(name: "Regional dessert", blurb: "Sweet, weird, perfect."),
        Entry(name: "Market tasting plate", blurb: "Small bites, big story."),
    ]

    private static let localGems: [String: [Entry]] = [
        "tokyo": [
            Entry(name: "Tsukiji outer market tamago", blurb: "Sweet egg on a stick — classic."),
            Entry(name: "Monjayaki in Tsukishima", blurb: "Messy, savory, very Tokyo."),
            Entry(name: "Standing sushi bar", blurb: "Fast, fresh, counter culture."),
        ],
        "osaka": [
            Entry(name: "Takoyaki in Dotonbori", blurb: "Crisp outside, molten inside."),
            Entry(name: "Okonomiyaki", blurb: "Osaka’s savory pancake ritual."),
            Entry(name: "Kushikatsu", blurb: "Deep-fried skewers, one dip rule."),
        ],
        "paris": [
            Entry(name: "Butter croissant", blurb: "Find a boulangerie with a line."),
            Entry(name: "Steak frites", blurb: "Classic bistro energy."),
            Entry(name: "Oysters & wine", blurb: "Counter lunch, Parisian flex."),
        ],
        "bangkok": [
            Entry(name: "Boat noodles", blurb: "Rich broth, tiny bowls, keep ordering."),
            Entry(name: "Mango sticky rice", blurb: "Peak tropical dessert."),
            Entry(name: "Som tam", blurb: "Spicy papaya salad punch."),
        ],
    ]

    private static let mustTryGems: [String: [Entry]] = [
        "tokyo": [
            Entry(name: "Ramen at a specialty shop", blurb: "Pick tonkotsu or shoyu and commit."),
            Entry(name: "Conveyor sushi", blurb: "Fun, fast, surprisingly good."),
            Entry(name: "Depachika food hall", blurb: "Department-store edible wonderland."),
        ],
        "osaka": [
            Entry(name: "Dotonbori neon walk + snacks", blurb: "Eat with your eyes first."),
            Entry(name: "Kuromon Market bites", blurb: "Seafood, wagyu, fruit on sticks."),
        ],
    ]
}

enum ItineraryFormatting {
    static func isoNow() -> String {
        ISO8601DateFormatter().string(from: Date())
    }

    static func newDraftId() -> String {
        "draft-\(Int(Date().timeIntervalSince1970 * 1000))"
    }
}

enum DataURLHelper {
    static func data(from dataUrl: String) -> Data? {
        if dataUrl.hasPrefix("data:"), let comma = dataUrl.firstIndex(of: ",") {
            let b64 = String(dataUrl[dataUrl.index(after: comma)...])
            return Data(base64Encoded: b64)
        }
        if let url = URL(string: dataUrl), url.isFileURL {
            return try? Data(contentsOf: url)
        }
        return nil
    }

    static func jpegDataURL(_ data: Data) -> String {
        "data:image/jpeg;base64,\(data.base64EncodedString())"
    }

    static func m4aDataURL(_ data: Data) -> String {
        "data:audio/mp4;base64,\(data.base64EncodedString())"
    }
}

struct MoodBadgeRow: View {
    let votes: MoodVotes?

    var body: some View {
        HStack(spacing: 6) {
            if let r1 = votes?.traveler1 {
                badge("T1", reaction: r1)
            }
            if let r2 = votes?.traveler2 {
                badge("T2", reaction: r2)
            }
        }
    }

    private func badge(_ traveler: String, reaction: MoodReaction) -> some View {
        HStack(spacing: 4) {
            Text(traveler)
                .font(.caption2.weight(.bold))
            Text(reaction.emoji)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(ShellChrome.accentSoft)
        .clipShape(Capsule())
    }
}
