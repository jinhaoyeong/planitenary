import Foundation

struct TripCopyLabels: Codable, Equatable {
    var itineraryTab: String
    var mapsTab: String
    var draftTab: String
    var budgetTab: String
    var checklistTab: String
    var documentsTab: String
    var photosTab: String
    var searchPlaceholder: String
    var overviewEyebrow: String
    var overviewIntroFilled: String
    var overviewIntroEmpty: String
    var backToOverview: String
    var customizePlan: String
    var doneCustomizing: String
    var resetPlan: String
    var photosButton: String
    var dayLabel: String
    var daysLabel: String
    var currentLocationLabel: String
    var spotsSuffix: String
    var openMapLabel: String
    var activityPhotosLabel: String
    var deleteActivityLabel: String
    var deleteActivityConfirm: String
}

struct TripThemeSettings: Codable, Equatable {
    var bg: String
    var bgElevated: String
    var ink: String
    var inkMuted: String
    var accent: String
    var accentSoft: String
}

enum ThemeMode: String, Codable, CaseIterable {
    case light, dark
}

struct ThemePalettePreset: Codable, Equatable, Identifiable {
    var id: String
    var name: String
    var description: String
    var light: TripThemeSettings
    var dark: TripThemeSettings
}

let DEFAULT_LIGHT_THEME = TripThemeSettings(
    bg: "#FAF7F2",
    bgElevated: "#FFFFFF",
    ink: "#0F0E0D",
    inkMuted: "#5C5853",
    accent: "#EE4D87",
    accentSoft: "#FFE4EE"
)

let DEFAULT_DARK_THEME = TripThemeSettings(
    bg: "#14110F",
    bgElevated: "#1F1A17",
    ink: "#F5EFE4",
    inkMuted: "#A39B8C",
    accent: "#FF6B9A",
    accentSoft: "#3A1F2A"
)

let THEME_PALETTE_PRESETS: [ThemePalettePreset] = [
    ThemePalettePreset(
        id: "ember-rose",
        name: "Ember Rose",
        description: "Warm paper by day, charcoal rose by night.",
        light: DEFAULT_LIGHT_THEME,
        dark: DEFAULT_DARK_THEME
    ),
    ThemePalettePreset(
        id: "midnight-slate",
        name: "Midnight Slate",
        description: "Cool mist in light mode, slate ink after dark.",
        light: TripThemeSettings(
            bg: "#F4F5F8",
            bgElevated: "#FFFFFF",
            ink: "#171A22",
            inkMuted: "#667085",
            accent: "#E7685D",
            accentSoft: "#F7D6DD"
        ),
        dark: TripThemeSettings(
            bg: "#171A22",
            bgElevated: "#232630",
            ink: "#F7F2EB",
            inkMuted: "#8E8678",
            accent: "#E7685D",
            accentSoft: "#41242C"
        )
    ),
    ThemePalettePreset(
        id: "forest",
        name: "Forest",
        description: "Linen green calm that deepens at night.",
        light: TripThemeSettings(
            bg: "#F3F5F4",
            bgElevated: "#FFFFFF",
            ink: "#15201C",
            inkMuted: "#5F6B66",
            accent: "#2F7D6E",
            accentSoft: "#DDEFEA"
        ),
        dark: TripThemeSettings(
            bg: "#121714",
            bgElevated: "#1B221D",
            ink: "#EEF3EC",
            inkMuted: "#8FA093",
            accent: "#2F7D6E",
            accentSoft: "#1E332C"
        )
    ),
    ThemePalettePreset(
        id: "coastal",
        name: "Coastal",
        description: "Sky-sheet pages with deep navy evenings.",
        light: TripThemeSettings(
            bg: "#F2F6F9",
            bgElevated: "#FFFFFF",
            ink: "#132033",
            inkMuted: "#5C6B7A",
            accent: "#3D8FB5",
            accentSoft: "#D7EAF3"
        ),
        dark: TripThemeSettings(
            bg: "#10161C",
            bgElevated: "#182129",
            ink: "#EEF4F7",
            inkMuted: "#8A9AA6",
            accent: "#3D8FB5",
            accentSoft: "#1A303A"
        )
    ),
    ThemePalettePreset(
        id: "amber",
        name: "Amber",
        description: "Sunlit sandstone that turns lamp-warm at night.",
        light: TripThemeSettings(
            bg: "#F7F0E8",
            bgElevated: "#FFFBF6",
            ink: "#1A140E",
            inkMuted: "#6B655D",
            accent: "#C8842A",
            accentSoft: "#F3E2C8"
        ),
        dark: TripThemeSettings(
            bg: "#16120C",
            bgElevated: "#221B13",
            ink: "#F8F0E3",
            inkMuted: "#A89880",
            accent: "#E0A045",
            accentSoft: "#3A2C18"
        )
    )
]

struct TripAppSettings: Codable, Equatable {
    var heroEyebrow: String
    var heroHeadline: String
    var heroDescription: String
    var heroPrimaryCta: String
    var heroSecondaryCta: String
    var coverLabel: String
    var coverHeadline: String
    var coverStatusEmpty: String
    var coverStatusFilled: String
    var coverModeEmpty: String
    var coverModeFilled: String
    var marqueeItems: [String]
    var coverImage: String?
    var immersiveEffects: Bool
    var labels: TripCopyLabels
    var theme: TripThemeSettings
    var lightTheme: TripThemeSettings
}

let DEFAULT_TRIP_SETTINGS = TripAppSettings(
    heroEyebrow: "A personalized travel starter",
    heroHeadline: "Plan your next trip your way.",
    heroDescription: "Add cities, days, notes, budgets, maps, and documents as you build your travel plan.",
    heroPrimaryCta: "Open handbook",
    heroSecondaryCta: "Open maps",
    coverLabel: "Custom cover",
    coverHeadline: "Add your\nown story",
    coverStatusEmpty: "No cities yet",
    coverStatusFilled: "{cities}",
    coverModeEmpty: "starter",
    coverModeFilled: "handbook",
    marqueeItems: ["Travel Handbook", "Plans", "Notes", "Maps", "Photos"],
    coverImage: nil,
    immersiveEffects: false,
    labels: TripCopyLabels(
        itineraryTab: "Itinerary",
        mapsTab: "Maps",
        draftTab: "Draft",
        budgetTab: "Budget",
        checklistTab: "Checklist",
        documentsTab: "Documents",
        photosTab: "Photo Wall",
        searchPlaceholder: "Search itinerary or locations...",
        overviewEyebrow: "The itinerary · day by day",
        overviewIntroFilled: "A day-by-day field guide for {cities}.",
        overviewIntroEmpty: "A blank day-by-day field guide ready for your trip details.",
        backToOverview: "Back to Overview",
        customizePlan: "Customize Plan",
        doneCustomizing: "Done Customizing",
        resetPlan: "Reset",
        photosButton: "Photos",
        dayLabel: "Day",
        daysLabel: "days",
        currentLocationLabel: "Current Location",
        spotsSuffix: "spots",
        openMapLabel: "Map",
        activityPhotosLabel: "Photos",
        deleteActivityLabel: "Delete",
        deleteActivityConfirm: "Delete this activity?"
    ),
    theme: DEFAULT_DARK_THEME,
    lightTheme: DEFAULT_LIGHT_THEME
)

func mergeThemeSettings(_ base: TripThemeSettings, _ override: TripThemeSettings) -> TripThemeSettings {
    TripThemeSettings(
        bg: override.bg.isEmpty ? base.bg : override.bg,
        bgElevated: override.bgElevated.isEmpty ? base.bgElevated : override.bgElevated,
        ink: override.ink.isEmpty ? base.ink : override.ink,
        inkMuted: override.inkMuted.isEmpty ? base.inkMuted : override.inkMuted,
        accent: override.accent.isEmpty ? base.accent : override.accent,
        accentSoft: override.accentSoft.isEmpty ? base.accentSoft : override.accentSoft
    )
}

func mergeCopyLabels(_ base: TripCopyLabels, _ override: TripCopyLabels) -> TripCopyLabels {
    TripCopyLabels(
        itineraryTab: override.itineraryTab.isEmpty ? base.itineraryTab : override.itineraryTab,
        mapsTab: override.mapsTab.isEmpty ? base.mapsTab : override.mapsTab,
        draftTab: override.draftTab.isEmpty ? base.draftTab : override.draftTab,
        budgetTab: override.budgetTab.isEmpty ? base.budgetTab : override.budgetTab,
        checklistTab: override.checklistTab.isEmpty ? base.checklistTab : override.checklistTab,
        documentsTab: override.documentsTab.isEmpty ? base.documentsTab : override.documentsTab,
        photosTab: override.photosTab.isEmpty ? base.photosTab : override.photosTab,
        searchPlaceholder: override.searchPlaceholder.isEmpty ? base.searchPlaceholder : override.searchPlaceholder,
        overviewEyebrow: override.overviewEyebrow.isEmpty ? base.overviewEyebrow : override.overviewEyebrow,
        overviewIntroFilled: override.overviewIntroFilled.isEmpty ? base.overviewIntroFilled : override.overviewIntroFilled,
        overviewIntroEmpty: override.overviewIntroEmpty.isEmpty ? base.overviewIntroEmpty : override.overviewIntroEmpty,
        backToOverview: override.backToOverview.isEmpty ? base.backToOverview : override.backToOverview,
        customizePlan: override.customizePlan.isEmpty ? base.customizePlan : override.customizePlan,
        doneCustomizing: override.doneCustomizing.isEmpty ? base.doneCustomizing : override.doneCustomizing,
        resetPlan: override.resetPlan.isEmpty ? base.resetPlan : override.resetPlan,
        photosButton: override.photosButton.isEmpty ? base.photosButton : override.photosButton,
        dayLabel: override.dayLabel.isEmpty ? base.dayLabel : override.dayLabel,
        daysLabel: override.daysLabel.isEmpty ? base.daysLabel : override.daysLabel,
        currentLocationLabel: override.currentLocationLabel.isEmpty ? base.currentLocationLabel : override.currentLocationLabel,
        spotsSuffix: override.spotsSuffix.isEmpty ? base.spotsSuffix : override.spotsSuffix,
        openMapLabel: override.openMapLabel.isEmpty ? base.openMapLabel : override.openMapLabel,
        activityPhotosLabel: override.activityPhotosLabel.isEmpty ? base.activityPhotosLabel : override.activityPhotosLabel,
        deleteActivityLabel: override.deleteActivityLabel.isEmpty ? base.deleteActivityLabel : override.deleteActivityLabel,
        deleteActivityConfirm: override.deleteActivityConfirm.isEmpty ? base.deleteActivityConfirm : override.deleteActivityConfirm
    )
}

func mergeTripSettings(_ settings: TripAppSettings?) -> TripAppSettings {
    guard let settings else { return DEFAULT_TRIP_SETTINGS }

    var merged = DEFAULT_TRIP_SETTINGS
    merged.heroEyebrow = settings.heroEyebrow
    merged.heroHeadline = settings.heroHeadline
    merged.heroDescription = settings.heroDescription
    merged.heroPrimaryCta = settings.heroPrimaryCta
    merged.heroSecondaryCta = settings.heroSecondaryCta
    merged.coverLabel = settings.coverLabel
    merged.coverHeadline = settings.coverHeadline
    merged.coverStatusEmpty = settings.coverStatusEmpty
    merged.coverStatusFilled = settings.coverStatusFilled
    merged.coverModeEmpty = settings.coverModeEmpty
    merged.coverModeFilled = settings.coverModeFilled
    merged.coverImage = settings.coverImage
    merged.immersiveEffects = settings.immersiveEffects
    merged.marqueeItems = settings.marqueeItems.isEmpty ? DEFAULT_TRIP_SETTINGS.marqueeItems : settings.marqueeItems
    merged.labels = mergeCopyLabels(DEFAULT_TRIP_SETTINGS.labels, settings.labels)
    merged.theme = mergeThemeSettings(DEFAULT_TRIP_SETTINGS.theme, settings.theme)
    merged.lightTheme = mergeThemeSettings(DEFAULT_TRIP_SETTINGS.lightTheme, settings.lightTheme)
    return merged
}

struct ShellThemePalettes: Codable, Equatable {
    var light: TripThemeSettings
    var dark: TripThemeSettings

    static let `default` = ShellThemePalettes(light: DEFAULT_LIGHT_THEME, dark: DEFAULT_DARK_THEME)
}

func themesMatch(_ a: TripThemeSettings, _ b: TripThemeSettings) -> Bool {
    a.bg.caseInsensitiveCompare(b.bg) == .orderedSame
        && a.bgElevated.caseInsensitiveCompare(b.bgElevated) == .orderedSame
        && a.ink.caseInsensitiveCompare(b.ink) == .orderedSame
        && a.inkMuted.caseInsensitiveCompare(b.inkMuted) == .orderedSame
        && a.accent.caseInsensitiveCompare(b.accent) == .orderedSame
        && a.accentSoft.caseInsensitiveCompare(b.accentSoft) == .orderedSame
}

func getPresetVariant(_ preset: ThemePalettePreset, mode: ThemeMode) -> TripThemeSettings {
    mode == .light ? preset.light : preset.dark
}

func getThemeForMode(settings: TripAppSettings, mode: ThemeMode) -> TripThemeSettings {
    mode == .light ? settings.lightTheme : settings.theme
}

func applyTemplate(_ template: String, replacements: [String: String]) -> String {
    var result = template
    for (key, value) in replacements {
        result = result.replacingOccurrences(of: "{\(key)}", with: value)
    }
    return result
}

func shellThemeFromTripSettings(_ settings: TripAppSettings) -> ShellThemePalettes {
    let merged = mergeTripSettings(settings)
    return ShellThemePalettes(light: merged.lightTheme, dark: merged.theme)
}
