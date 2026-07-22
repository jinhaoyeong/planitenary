// Info.plist: NSPhotoLibraryUsageDescription — attach draft screenshots.

import PhotosUI
import SwiftUI

struct DraftView: View {
    @ObservedObject var session: TripSession

    @State private var drafts: [DraftItem] = []
    @State private var editingDraft: DraftItem?
    @State private var isFormPresented = false

    @State private var formName = ""
    @State private var formLink = ""
    @State private var formNote = ""
    @State private var formDay = 1
    @State private var formTime = "10:00"
    @State private var formType: ActivityType = .sight
    @State private var screenshotItems: [PhotosPickerItem] = []
    @State private var screenshotDataUrls: [String] = []
    @State private var isFetchingPreview = false

    private var tripId: String? { session.activeItineraryId ?? session.itinerary?.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            EditorialPageHeader(
                eyebrow: "The draft book · ideas & finds",
                titleLeading: "Scraps &",
                titleAccent: "shortlists.",
                subtitle: "A loose pile of places we spotted on Rednote, TikTok, and friends' maps. Pin, tag, and pull the good ones into the itinerary.",
                centered: true,
                titleSize: 42
            )
            draftForm
            draftsList
        }
        .padding(20)
        .onAppear { loadDrafts() }
    }

    private var draftForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Circle().fill(ShellChrome.accent).frame(width: 6, height: 6)
                Text((isFormPresented || editingDraft != nil ? "Edit idea" : "Add a new idea").uppercased())
                    .font(.caption.weight(.semibold))
                    .tracking(1.4)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            TextField("Name", text: $formName)
                .textFieldStyle(.roundedBorder)
            TextField("Link", text: $formLink)
                .textFieldStyle(.roundedBorder)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
                .onChange(of: formLink) { _, link in
                    if detectsRedNote(link) { fetchRedNotePreview(for: link) }
                }
            TextField("Note", text: $formNote, axis: .vertical)
                .lineLimit(2 ... 5)
                .textFieldStyle(.roundedBorder)
            Picker("Day", selection: $formDay) {
                ForEach(session.itinerary?.days ?? [], id: \.day) { day in
                    Text("Day \(day.day)").tag(day.day)
                }
            }
            TextField("Time", text: $formTime)
                .textFieldStyle(.roundedBorder)
            Picker("Type", selection: $formType) {
                ForEach(ActivityType.allCases) { t in
                    Text(t.label).tag(t)
                }
            }
            PhotosPicker(selection: $screenshotItems, maxSelectionCount: 6, matching: .images) {
                Label("Screenshots (max 6)", systemImage: "photo.on.rectangle.angled")
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(ShellChrome.accentSoft)
                    .clipShape(Capsule())
            }
            .onChange(of: screenshotItems) { _, items in
                Task { await loadScreenshots(from: items) }
            }
            if !screenshotDataUrls.isEmpty {
                Text("\(screenshotDataUrls.count) screenshot(s) attached")
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            if isFetchingPreview {
                ProgressView("Fetching RedNote preview…")
            }
            HStack(spacing: 10) {
                PillButton(title: editingDraft == nil ? "Save draft" : "Update", systemImage: "square.and.arrow.down", kind: .primary) {
                    saveDraft()
                }
                if editingDraft != nil {
                    PillButton(title: "Cancel", kind: .ghost) {
                        clearForm()
                    }
                }
            }
        }
        .padding(16)
        .shellCard()
    }

    private var draftsList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your drafts")
                .font(.headline)
            if drafts.isEmpty {
                Text("Save links, notes, and screenshots to turn into activities later.")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            } else {
                ForEach(drafts) { draft in
                    draftRow(draft)
                }
            }
        }
    }

    private func draftRow(_ draft: DraftItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(draft.name)
                    .font(.headline)
                if draft.isRedNote == true {
                    Text("RedNote")
                        .font(.caption2.weight(.bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(ShellChrome.accentSoft)
                        .clipShape(Capsule())
                }
            }
            if let preview = draft.previewTitle {
                Text(preview)
                    .font(.subheadline.weight(.semibold))
            }
            if let previewText = draft.previewText {
                Text(previewText)
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)
                    .lineLimit(3)
            }
            if !draft.note.isEmpty {
                Text(draft.note)
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            Text("Day \(draft.day) · \(draft.time) · \(draft.type.label)")
                .font(.caption)
                .foregroundStyle(ShellChrome.inkMuted)
            HStack(spacing: 8) {
                CompactPillButton(title: "Edit", kind: .soft) {
                    loadIntoForm(draft)
                }
                CompactPillButton(title: "Delete", kind: .soft) {
                    deleteDraft(draft)
                }
                CompactPillButton(title: "Add to plan", systemImage: "plus", kind: .primary) {
                    addDraftToPlan(draft)
                }
                if let url = URL(string: draft.link), !draft.link.isEmpty {
                    Link(destination: url) {
                        Text("Open")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(ShellChrome.accentSoft)
                            .clipShape(Capsule())
                    }
                }
            }
        }
        .padding(16)
        .shellCard()
    }

    private func loadDrafts() {
        guard let tripId else { return }
        drafts = LocalStore.loadDrafts(tripId: tripId)
        formDay = session.itinerary?.days.first?.day ?? 1
    }

    private func persist() {
        guard let tripId else { return }
        LocalStore.saveDrafts(drafts, tripId: tripId)
    }

    private func saveDraft() {
        guard tripId != nil else { return }
        let trimmedName = formName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return }

        var item = editingDraft ?? DraftItem(
            id: ItineraryFormatting.newDraftId(),
            name: trimmedName,
            link: formLink,
            note: formNote,
            day: formDay,
            time: formTime,
            type: formType,
            isRedNote: detectsRedNote(formLink),
            previewTitle: nil,
            previewText: nil,
            thumbnailUrl: nil,
            screenshotUrls: nil,
            updatedAt: nil
        )
        item.name = trimmedName
        item.link = formLink
        item.note = formNote
        item.day = formDay
        item.time = formTime
        item.type = formType
        item.isRedNote = detectsRedNote(formLink)
        item.screenshotUrls = screenshotDataUrls.isEmpty ? nil : screenshotDataUrls
        item.updatedAt = ItineraryFormatting.isoNow()

        if let existing = editingDraft,
           let idx = drafts.firstIndex(where: { $0.id == existing.id }) {
            drafts[idx] = item
        } else {
            drafts.insert(item, at: 0)
        }
        persist()
        clearForm()
    }

    private func deleteDraft(_ draft: DraftItem) {
        drafts.removeAll { $0.id == draft.id }
        persist()
        if editingDraft?.id == draft.id { clearForm() }
    }

    private func addDraftToPlan(_ draft: DraftItem) {
        let descriptionParts = [draft.note, draft.previewText].compactMap { $0 }.filter { !$0.isEmpty }
        let activity = Activity(
            time: draft.time,
            name: draft.name,
            description: descriptionParts.joined(separator: "\n\n"),
            type: draft.type,
            location: draft.previewTitle,
            cost: nil,
            rating: nil,
            coordinates: nil,
            moodVotes: nil,
            voiceNote: nil
        )
        session.updateItinerary { itinerary in
            guard let idx = itinerary.days.firstIndex(where: { $0.day == draft.day }) else { return }
            itinerary.days[idx].activities.append(activity)
        }
    }

    private func loadIntoForm(_ draft: DraftItem) {
        editingDraft = draft
        formName = draft.name
        formLink = draft.link
        formNote = draft.note
        formDay = draft.day
        formTime = draft.time
        formType = draft.type
        screenshotDataUrls = draft.screenshotUrls ?? []
        isFormPresented = true
    }

    private func clearForm() {
        editingDraft = nil
        isFormPresented = false
        formName = ""
        formLink = ""
        formNote = ""
        formTime = "10:00"
        formType = .sight
        screenshotItems = []
        screenshotDataUrls = []
        formDay = session.itinerary?.days.first?.day ?? 1
    }

    private func detectsRedNote(_ link: String) -> Bool {
        let lower = link.lowercased()
        return lower.contains("xiaohongshu") || lower.contains("rednote") || lower.contains("xhslink")
    }

    private func fetchRedNotePreview(for link: String) {
        guard detectsRedNote(link) else { return }
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let url = URL(string: "https://r.jina.ai/\(trimmed)") else { return }
        isFetchingPreview = true
        Task {
            defer { isFetchingPreview = false }
            do {
                var request = URLRequest(url: url)
                request.setValue("TravelHandbook-iOS/1.0", forHTTPHeaderField: "User-Agent")
                let (data, _) = try await URLSession.shared.data(for: request)
                let text = String(data: data, encoding: .utf8) ?? ""
                let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
                let title = lines.first.map(String.init) ?? "RedNote link"
                let body = lines.dropFirst().joined(separator: "\n").prefix(400)
                if editingDraft == nil, formName.isEmpty {
                    formName = title
                }
                if var draft = editingDraft,
                   let idx = drafts.firstIndex(where: { $0.id == draft.id }) {
                    draft.previewTitle = title
                    draft.previewText = String(body)
                    draft.isRedNote = true
                    drafts[idx] = draft
                    persist()
                }
                formNote = formNote.isEmpty ? String(body) : formNote
            } catch {
                // Preview optional — ignore failures.
            }
        }
    }

    private func loadScreenshots(from items: [PhotosPickerItem]) async {
        var urls: [String] = []
        for item in items.prefix(6) {
            if let data = try? await item.loadTransferable(type: Data.self) {
                urls.append(DataURLHelper.jpegDataURL(data))
            }
        }
        screenshotDataUrls = urls
    }
}
