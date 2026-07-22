import PhotosUI
import SwiftUI
import UIKit

struct HandbookSettingsView: View {
    @EnvironmentObject private var auth: AuthViewModel
    @EnvironmentObject private var themeManager: ThemeManager
    @ObservedObject var session: TripSession

    @State private var tripTitle = ""
    @State private var citiesText = ""
    @State private var tripDescription = ""
    @State private var marqueeText = ""
    @State private var settings = DEFAULT_TRIP_SETTINGS
    @State private var selectedCoverItem: PhotosPickerItem?
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var isSaving = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SectionHeader(eyebrow: "Trip Story", title: "Handbook Settings")

            if let errorMessage {
                banner(errorMessage, tint: .red)
            }
            if let statusMessage {
                banner(statusMessage, tint: ShellChrome.accent)
            }

            storySection
            copySection
            themeSection

            PillButton(
                title: isSaving ? "Saving…" : "Save Handbook Settings",
                systemImage: "square.and.arrow.down",
                kind: .primary,
                isEnabled: !isSaving,
                action: saveChanges
            )
        }
        .padding(20)
        .background(ShellChrome.background)
        .task(id: session.activeItineraryId) {
            loadFromSession()
        }
        .onChange(of: selectedCoverItem) { _, newValue in
            guard let newValue else { return }
            Task { await loadCoverImage(from: newValue) }
        }
    }

    private var storySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeading("Trip Story", actionTitle: "Revert", action: loadFromSession)

            editableCard {
                VStack(alignment: .leading, spacing: 14) {
                    labeledField("Trip title", text: $tripTitle)
                    labeledField("Cities (comma separated)", text: $citiesText)
                    multilineField("Trip description", text: $tripDescription, axis: .vertical, lineLimit: 4...8)
                    labeledField("Hero eyebrow", text: $settings.heroEyebrow)
                    multilineField("Hero headline", text: $settings.heroHeadline, axis: .vertical, lineLimit: 2...4)
                    multilineField("Hero description", text: $settings.heroDescription, axis: .vertical, lineLimit: 3...6)
                    labeledField("Hero primary CTA", text: $settings.heroPrimaryCta)
                    labeledField("Hero secondary CTA", text: $settings.heroSecondaryCta)
                    labeledField("Cover label", text: $settings.coverLabel)
                    multilineField("Cover headline", text: $settings.coverHeadline, axis: .vertical, lineLimit: 2...4)
                    labeledField("Cover status when empty", text: $settings.coverStatusEmpty)
                    labeledField("Cover status when filled", text: $settings.coverStatusFilled)
                    labeledField("Cover mode when empty", text: $settings.coverModeEmpty)
                    labeledField("Cover mode when filled", text: $settings.coverModeFilled)
                    multilineField("Marquee items (comma separated)", text: $marqueeText, axis: .vertical, lineLimit: 2...4)

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Cover image")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(ShellChrome.ink)

                        PhotosPicker(selection: $selectedCoverItem, matching: .images) {
                            HStack(spacing: 12) {
                                coverImagePreview
                                    .frame(width: 88, height: 88)
                                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .stroke(ShellChrome.border, lineWidth: 1)
                                    )

                                VStack(alignment: .leading, spacing: 6) {
                                    Text("Choose cover from Photos")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(ShellChrome.ink)
                                    Text("Stored locally inside trip settings.")
                                        .font(.caption)
                                        .foregroundStyle(ShellChrome.inkMuted)
                                }

                                Spacer()
                            }
                            .padding(14)
                            .background(ShellChrome.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }
                        .buttonStyle(.plain)

                        if settings.coverImage != nil {
                            CompactPillButton(title: "Remove Cover Image", systemImage: "trash", kind: .soft) {
                                settings.coverImage = nil
                            }
                        }
                    }
                }
            }
        }
    }

    private var copySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeading("App Copy")

            editableCard {
                VStack(alignment: .leading, spacing: 14) {
                    labeledField("Itinerary tab", text: $settings.labels.itineraryTab)
                    labeledField("Maps tab", text: $settings.labels.mapsTab)
                    labeledField("Draft tab", text: $settings.labels.draftTab)
                    labeledField("Budget tab", text: $settings.labels.budgetTab)
                    labeledField("Checklist tab", text: $settings.labels.checklistTab)
                    labeledField("Documents tab", text: $settings.labels.documentsTab)
                    labeledField("Photos tab", text: $settings.labels.photosTab)
                    labeledField("Search placeholder", text: $settings.labels.searchPlaceholder)
                    labeledField("Overview eyebrow", text: $settings.labels.overviewEyebrow)
                    multilineField("Overview intro (filled)", text: $settings.labels.overviewIntroFilled, axis: .vertical, lineLimit: 2...4)
                    multilineField("Overview intro (empty)", text: $settings.labels.overviewIntroEmpty, axis: .vertical, lineLimit: 2...4)
                    labeledField("Back to overview", text: $settings.labels.backToOverview)
                    labeledField("Customize plan", text: $settings.labels.customizePlan)
                    labeledField("Done customizing", text: $settings.labels.doneCustomizing)
                    labeledField("Reset plan", text: $settings.labels.resetPlan)
                    labeledField("Photos button", text: $settings.labels.photosButton)
                    labeledField("Day label", text: $settings.labels.dayLabel)
                    labeledField("Days label", text: $settings.labels.daysLabel)
                    labeledField("Current location label", text: $settings.labels.currentLocationLabel)
                    labeledField("Spots suffix", text: $settings.labels.spotsSuffix)
                    labeledField("Open map label", text: $settings.labels.openMapLabel)
                    labeledField("Activity photos label", text: $settings.labels.activityPhotosLabel)
                    labeledField("Delete activity label", text: $settings.labels.deleteActivityLabel)
                    labeledField("Delete activity confirm", text: $settings.labels.deleteActivityConfirm)
                }
            }
        }
    }

    private var themeSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            sectionHeading("Theme")

            editableCard {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Palette presets")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ShellChrome.ink)

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(THEME_PALETTE_PRESETS) { preset in
                                Button {
                                    settings.lightTheme = preset.light
                                    settings.theme = preset.dark
                                } label: {
                                    VStack(alignment: .leading, spacing: 10) {
                                        HStack(spacing: 6) {
                                            ForEach(presetSwatches(for: preset), id: \.self) { hex in
                                                Circle()
                                                    .fill(Color(hex: hex))
                                                    .frame(width: 14, height: 14)
                                            }
                                        }
                                        Text(preset.name)
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(ShellChrome.ink)
                                        Text(preset.description)
                                            .font(.caption)
                                            .foregroundStyle(ShellChrome.inkMuted)
                                            .multilineTextAlignment(.leading)
                                    }
                                    .padding(14)
                                    .frame(width: 200, alignment: .leading)
                                    .background(
                                        presetMatches(preset) ? ShellChrome.accentSoft : ShellChrome.cardBackground,
                                        in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                                            .stroke(presetMatches(preset) ? ShellChrome.accent : ShellChrome.border, lineWidth: 1)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 2)
                    }

                    Toggle(isOn: $settings.immersiveEffects) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Immersive effects")
                                .font(.subheadline.weight(.semibold))
                            Text("Enable motion-forward styling for the handbook shell.")
                                .font(.caption)
                                .foregroundStyle(ShellChrome.inkMuted)
                        }
                    }
                    .tint(ShellChrome.accent)

                    ThemeTokenEditorCard(title: "Light Palette", theme: $settings.lightTheme)
                    ThemeTokenEditorCard(title: "Dark Palette", theme: $settings.theme)

                    ThemePreviewCard(
                        title: tripTitle.trimmedForDisplay(defaultValue: session.tripDisplayName),
                        cities: parsedList(from: citiesText),
                        settings: settings,
                        activeMode: themeManager.mode
                    )
                }
            }
        }
    }

    private var coverImagePreview: some View {
        Group {
            if let uiImage = imageFromDataURL(settings.coverImage) {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFill()
            } else {
                ZStack {
                    LinearGradient(
                        colors: [ShellChrome.accentSoft, ShellChrome.cardBackground],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                    Image(systemName: "photo")
                        .font(.title2)
                        .foregroundStyle(ShellChrome.accent)
                }
            }
        }
    }

    private func sectionHeading(_ title: String, actionTitle: String? = nil, action: (() -> Void)? = nil) -> some View {
        HStack(alignment: .center) {
            Text(title)
                .font(.headline)
                .foregroundStyle(ShellChrome.ink)
            Spacer()
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ShellChrome.accent)
            }
        }
    }

    private func editableCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(18)
            .shellCard()
    }

    private func labeledField(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)
            TextField(title, text: text)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(ShellChrome.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(ShellChrome.border, lineWidth: 1)
                )
        }
    }

    private func multilineField(
        _ title: String,
        text: Binding<String>,
        axis: Axis,
        lineLimit: ClosedRange<Int>
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)
            TextField(title, text: text, axis: axis)
                .lineLimit(lineLimit)
                .textFieldStyle(.plain)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(ShellChrome.cardBackground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(ShellChrome.border, lineWidth: 1)
                )
        }
    }

    private func banner(_ text: String, tint: Color) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: tint == .red ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
            Text(text)
                .font(.subheadline)
        }
        .foregroundStyle(tint)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func loadFromSession() {
        let itinerary = session.itinerary ?? session.createStarter(id: session.activeItineraryId ?? "trip-preview")
        tripTitle = itinerary.name
        citiesText = itinerary.cities.joined(separator: ", ")
        tripDescription = itinerary.description
        settings = mergeTripSettings(session.tripSettings)
        marqueeText = settings.marqueeItems.joined(separator: ", ")
        selectedCoverItem = nil
        errorMessage = nil
    }

    private func saveChanges() {
        guard let tripId = session.activeItineraryId else {
            errorMessage = "Open a trip before editing handbook settings."
            return
        }

        isSaving = true
        defer { isSaving = false }

        var nextSettings = mergeTripSettings(settings)
        nextSettings.marqueeItems = parsedList(from: marqueeText).isEmpty
            ? DEFAULT_TRIP_SETTINGS.marqueeItems
            : parsedList(from: marqueeText)
        nextSettings.theme = normalizedTheme(nextSettings.theme)
        nextSettings.lightTheme = normalizedTheme(nextSettings.lightTheme)

        let nextTitle = tripTitle.trimmedForDisplay(defaultValue: "Untitled Trip")
        let nextCities = parsedList(from: citiesText)
        let nextDescription = tripDescription.trimmingCharacters(in: .whitespacesAndNewlines)

        session.updateItinerary { itinerary in
            itinerary.name = nextTitle
            itinerary.cities = nextCities
            itinerary.description = nextDescription.isEmpty ? itinerary.description : nextDescription
        }
        session.tripSettings = nextSettings
        LocalStore.saveTripSettings(nextSettings, tripId: tripId)
        LocalStore.saveShellTheme(shellThemeFromTripSettings(nextSettings), userId: auth.user?.id)

        statusMessage = "Saved handbook story, copy, and theme for this trip."
        errorMessage = nil
        Haptics.successNotification()
    }

    private func loadCoverImage(from item: PhotosPickerItem) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                errorMessage = "Could not load the selected photo."
                return
            }
            settings.coverImage = dataURL(for: data)
            statusMessage = "Cover image updated. Save to keep it with this trip."
            errorMessage = nil
            Haptics.lightImpact()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func dataURL(for data: Data) -> String {
        let mime = data.isPNG ? "image/png" : "image/jpeg"
        return "data:\(mime);base64,\(data.base64EncodedString())"
    }

    private func imageFromDataURL(_ dataURL: String?) -> UIImage? {
        guard let dataURL,
              let comma = dataURL.firstIndex(of: ",") else { return nil }
        let encoded = String(dataURL[dataURL.index(after: comma)...])
        guard let data = Data(base64Encoded: encoded) else { return nil }
        return UIImage(data: data)
    }

    private func parsedList(from text: String) -> [String] {
        text
            .split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    private func normalizedTheme(_ theme: TripThemeSettings) -> TripThemeSettings {
        TripThemeSettings(
            bg: sanitizeHex(theme.bg, fallback: DEFAULT_LIGHT_THEME.bg),
            bgElevated: sanitizeHex(theme.bgElevated, fallback: DEFAULT_LIGHT_THEME.bgElevated),
            ink: sanitizeHex(theme.ink, fallback: DEFAULT_LIGHT_THEME.ink),
            inkMuted: sanitizeHex(theme.inkMuted, fallback: DEFAULT_LIGHT_THEME.inkMuted),
            accent: sanitizeHex(theme.accent, fallback: DEFAULT_LIGHT_THEME.accent),
            accentSoft: sanitizeHex(theme.accentSoft, fallback: DEFAULT_LIGHT_THEME.accentSoft)
        )
    }

    private func sanitizeHex(_ value: String, fallback: String) -> String {
        let filtered = value.uppercased().filter(\.isHexDigit)
        if filtered.count == 6 || filtered.count == 8 {
            return "#\(filtered)"
        }
        return fallback
    }

    private func presetMatches(_ preset: ThemePalettePreset) -> Bool {
        themesMatch(settings.lightTheme, preset.light) && themesMatch(settings.theme, preset.dark)
    }

    private func presetSwatches(for preset: ThemePalettePreset) -> [String] {
        [preset.light.bg, preset.light.accent, preset.dark.bg, preset.dark.accent]
    }
}

private struct ThemeTokenEditorCard: View {
    let title: String
    @Binding var theme: TripThemeSettings

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
                .foregroundStyle(ShellChrome.ink)

            ThemeTokenRow(title: "Background", hex: $theme.bg)
            ThemeTokenRow(title: "Elevated background", hex: $theme.bgElevated)
            ThemeTokenRow(title: "Ink", hex: $theme.ink)
            ThemeTokenRow(title: "Muted ink", hex: $theme.inkMuted)
            ThemeTokenRow(title: "Accent", hex: $theme.accent)
            ThemeTokenRow(title: "Soft accent", hex: $theme.accentSoft)
        }
        .padding(16)
        .background(ShellChrome.background, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(ShellChrome.border, lineWidth: 1)
        )
    }
}

private struct ThemeTokenRow: View {
    let title: String
    @Binding var hex: String

    var body: some View {
        HStack(spacing: 12) {
            ColorPicker("", selection: colorBinding)
                .labelsHidden()

            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(ShellChrome.ink)

            Spacer()

            TextField("#RRGGBB", text: sanitizedHexBinding)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .multilineTextAlignment(.trailing)
                .font(.system(.subheadline, design: .monospaced))
                .frame(width: 110)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(ShellChrome.cardBackground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(ShellChrome.border, lineWidth: 1)
                )
        }
    }

    private var colorBinding: Binding<Color> {
        Binding(
            get: { Color(hex: hex) },
            set: { newColor in
                hex = Self.hexString(from: newColor)
            }
        )
    }

    private var sanitizedHexBinding: Binding<String> {
        Binding(
            get: { hex },
            set: { newValue in
                let filtered = newValue.uppercased().filter { $0.isHexDigit }
                hex = filtered.isEmpty ? "#" : "#\(String(filtered.prefix(8)))"
            }
        )
    }

    private static func hexString(from color: Color) -> String {
        let uiColor = UIColor(color)
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        guard uiColor.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else {
            return "#000000"
        }
        if alpha < 0.999 {
            return String(
                format: "#%02X%02X%02X%02X",
                Int(red * 255),
                Int(green * 255),
                Int(blue * 255),
                Int(alpha * 255)
            )
        }
        return String(format: "#%02X%02X%02X", Int(red * 255), Int(green * 255), Int(blue * 255))
    }
}

private struct ThemePreviewCard: View {
    let title: String
    let cities: [String]
    let settings: TripAppSettings
    let activeMode: ThemeMode

    var body: some View {
        let palette = getThemeForMode(settings: settings, mode: activeMode)
        let colors = AppColors(palette: palette, mode: activeMode)

        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(activeMode == .light ? "Live preview · Light mode" : "Live preview · Dark mode")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(colors.accent)
                Spacer()
                Text(settings.immersiveEffects ? "Immersive on" : "Immersive off")
                    .font(.caption)
                    .foregroundStyle(colors.inkMuted)
            }

            Text(settings.heroEyebrow)
                .font(.caption.weight(.semibold))
                .tracking(1.2)
                .foregroundStyle(colors.inkMuted)

            Text(title)
                .font(.system(.title2, design: .serif).weight(.bold))
                .foregroundStyle(colors.ink)

            Text(cities.isEmpty ? settings.coverStatusEmpty : cities.joined(separator: " · "))
                .font(.subheadline)
                .foregroundStyle(colors.inkMuted)

            Text(settings.heroDescription)
                .font(.subheadline)
                .foregroundStyle(colors.ink)
                .lineLimit(3)

            HStack(spacing: 8) {
                ForEach(settings.marqueeItems.prefix(4), id: \.self) { item in
                    Text(item)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(colors.accent)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(colors.accentSoft, in: Capsule())
                }
            }

            HStack(spacing: 10) {
                Label(settings.heroPrimaryCta, systemImage: "sparkles")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(colors.accent, in: Capsule())

                Text(settings.heroSecondaryCta)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(colors.inkMuted)
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.bgElevated, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(colors.accentSoft, lineWidth: 1)
        )
        .background(colors.bg, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
    }
}

private extension String {
    func trimmedForDisplay(defaultValue: String) -> String {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? defaultValue : trimmed
    }
}

private extension Data {
    var isPNG: Bool {
        count >= 8 && prefix(8) == Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    }
}
