// Info.plist: NSMicrophoneUsageDescription — record voice notes on activities.
// Info.plist: NSPhotoLibraryUsageDescription — attach day photos and captions.

import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

struct ActivityIndexRef: Identifiable, Hashable {
    let index: Int
    var id: Int { index }
}

struct DayDetailView: View {
    @ObservedObject var session: TripSession
    let dayNumber: Int

    @State private var showAddActivity = false
    @State private var editingActivity: ActivityIndexRef?
    @State private var moodActivity: ActivityIndexRef?
    @State private var showPhotoGallery = false
    @State private var showFoodPicker = false
    @State private var isEditingDayMeta = false
    @State private var dayTitleDraft = ""
    @State private var dayDateDraft = ""
    @State private var dayCityDraft = ""

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                dayHeader
                actionRow
                activitiesSection
            }
            .padding(20)
        }
        .background(ShellChrome.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button("Overview") { dismiss() }
                    .foregroundStyle(ShellChrome.accent)
            }
        }
        .sheet(isPresented: $showAddActivity) {
            ActivityFormSheet(mode: .add) { activity in
                appendActivity(activity)
            }
        }
        .sheet(item: $editingActivity) { ref in
            if let activity = activity(at: ref.index) {
                ActivityFormSheet(mode: .edit(activity)) { updated in
                    replaceActivity(at: ref.index, with: updated)
                } onDelete: {
                    deleteActivity(at: ref.index)
                }
            }
        }
        .sheet(item: $moodActivity) { ref in
            if let activity = activity(at: ref.index) {
                MoodBoardSheet(initial: activity.moodVotes ?? MoodVotes()) { votes in
                    updateActivity(at: ref.index) { $0.moodVotes = votes }
                }
            }
        }
        .sheet(isPresented: $showPhotoGallery) {
            DayPhotoGallerySheet(session: session, dayNumber: dayNumber) { photos in
                updateDay { $0.photos = photos.isEmpty ? nil : photos }
            }
        }
        .sheet(isPresented: $showFoodPicker) {
            FoodPickerSheet(city: dayPlan?.city ?? "") { activity in
                appendActivity(activity)
            }
        }
        .sheet(isPresented: $isEditingDayMeta) {
            NavigationStack {
                Form {
                    TextField("Title", text: $dayTitleDraft)
                    TextField("Date", text: $dayDateDraft)
                    TextField("City", text: $dayCityDraft)
                }
                .navigationTitle("Edit day")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { isEditingDayMeta = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            updateDay {
                                $0.title = dayTitleDraft
                                $0.date = dayDateDraft
                                $0.city = dayCityDraft
                            }
                            isEditingDayMeta = false
                        }
                    }
                }
            }
            .presentationDetents([.medium])
        }
    }

    private var dayPlan: DayPlan? {
        session.itinerary?.days.first { $0.day == dayNumber }
    }

    private var dayHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let day = dayPlan {
                Text("Day \(day.day)")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(ShellChrome.accent)
                Text(day.title)
                    .font(.title2.weight(.bold))
                    .foregroundStyle(ShellChrome.ink)
                HStack(spacing: 16) {
                    Label(day.city, systemImage: "mappin.and.ellipse")
                    Label(day.date, systemImage: "calendar")
                }
                .font(.subheadline)
                .foregroundStyle(ShellChrome.inkMuted)
            }
            CompactPillButton(title: "Edit day info", systemImage: "pencil", kind: .soft) {
                dayTitleDraft = dayPlan?.title ?? ""
                dayDateDraft = dayPlan?.date ?? ""
                dayCityDraft = dayPlan?.city ?? ""
                isEditingDayMeta = true
            }
        }
    }

    private var actionRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                CompactPillButton(title: "Add", systemImage: "plus", kind: .primary) {
                    showAddActivity = true
                }
                CompactPillButton(title: "Food spin", systemImage: "fork.knife", kind: .soft) {
                    showFoodPicker = true
                }
                CompactPillButton(title: "Photos", systemImage: "photo", kind: .soft) {
                    showPhotoGallery = true
                }
            }
        }
    }

    private var activitiesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Activities")
                .font(.headline)
                .foregroundStyle(ShellChrome.ink)

            if dayPlan?.activities.isEmpty ?? true {
                Text("No activities yet — add one or spin for food.")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
                    .padding(.vertical, 8)
            } else {
                ForEach(Array((dayPlan?.activities ?? []).enumerated()), id: \.offset) { index, activity in
                    activityRow(activity, index: index)
                }
            }
        }
    }

    private func activityRow(_ activity: Activity, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: activity.type.systemImage)
                    .font(.title3)
                    .foregroundStyle(ShellChrome.accent)
                    .frame(width: 32)
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(activity.time)
                            .font(.caption.weight(.bold))
                            .foregroundStyle(ShellChrome.inkMuted)
                        Text(activity.name)
                            .font(.headline)
                            .foregroundStyle(ShellChrome.ink)
                    }
                    if let location = activity.location, !location.isEmpty {
                        Text(location)
                            .font(.subheadline)
                            .foregroundStyle(ShellChrome.inkMuted)
                    }
                    if !activity.description.isEmpty {
                        Text(activity.description)
                            .font(.subheadline)
                            .foregroundStyle(ShellChrome.inkMuted)
                    }
                    HStack(spacing: 12) {
                        if let cost = activity.cost, !cost.isEmpty {
                            Label(cost, systemImage: "yensign.circle")
                                .font(.caption)
                        }
                        if let rating = activity.rating {
                            Label(String(format: "%.1f", rating), systemImage: "star.fill")
                                .font(.caption)
                        }
                    }
                    .foregroundStyle(ShellChrome.inkMuted)
                    MoodBadgeRow(votes: activity.moodVotes)
                }
                Spacer()
            }

            HStack(spacing: 8) {
                CompactPillButton(title: "Edit", kind: .soft) {
                    editingActivity = ActivityIndexRef(index: index)
                }
                CompactPillButton(title: "Mood", kind: .soft) {
                    moodActivity = ActivityIndexRef(index: index)
                }
                ActivityVoiceNoteControl(
                    voiceNote: activity.voiceNote,
                    onSave: { note in
                        updateActivity(at: index) { $0.voiceNote = note }
                    },
                    onClear: {
                        updateActivity(at: index) { $0.voiceNote = nil }
                    }
                )
            }
        }
        .padding(16)
        .shellCard()
    }

    private func activity(at index: Int) -> Activity? {
        guard let day = dayPlan, day.activities.indices.contains(index) else { return nil }
        return day.activities[index]
    }

    private func updateDay(_ transform: (inout DayPlan) -> Void) {
        session.updateItinerary { itinerary in
            guard let idx = itinerary.days.firstIndex(where: { $0.day == dayNumber }) else { return }
            transform(&itinerary.days[idx])
        }
    }

    private func appendActivity(_ activity: Activity) {
        updateDay { $0.activities.append(activity) }
    }

    private func replaceActivity(at index: Int, with activity: Activity) {
        updateDay {
            guard $0.activities.indices.contains(index) else { return }
            $0.activities[index] = activity
        }
    }

    private func deleteActivity(at index: Int) {
        updateDay {
            guard $0.activities.indices.contains(index) else { return }
            $0.activities.remove(at: index)
        }
    }

    private func updateActivity(at index: Int, _ transform: (inout Activity) -> Void) {
        updateDay {
            guard $0.activities.indices.contains(index) else { return }
            transform(&$0.activities[index])
        }
    }
}

// MARK: - Activity form

enum ActivityFormMode {
    case add
    case edit(Activity)
}

struct ActivityFormSheet: View {
    let mode: ActivityFormMode
    let onSave: (Activity) -> Void
    var onDelete: (() -> Void)?

    @Environment(\.dismiss) private var dismiss

    @State private var type: ActivityType = .sight
    @State private var time = "09:00"
    @State private var name = ""
    @State private var descriptionText = ""
    @State private var location = ""
    @State private var cost = ""
    @State private var rating: Double = 0
    @State private var useRating = false
    @State private var coordinates: [Double]?
    @State private var geocodeQuery = ""
    @State private var geocodeResults: [NominatimPlace] = []
    @State private var isSearching = false

    init(mode: ActivityFormMode, onSave: @escaping (Activity) -> Void, onDelete: (() -> Void)? = nil) {
        self.mode = mode
        self.onSave = onSave
        self.onDelete = onDelete
        if case .edit(let activity) = mode {
            _type = State(initialValue: activity.type)
            _time = State(initialValue: activity.time)
            _name = State(initialValue: activity.name)
            _descriptionText = State(initialValue: activity.description)
            _location = State(initialValue: activity.location ?? "")
            _cost = State(initialValue: activity.cost ?? "")
            _rating = State(initialValue: activity.rating ?? 0)
            _useRating = State(initialValue: activity.rating != nil)
            _coordinates = State(initialValue: activity.coordinates)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Type", selection: $type) {
                    ForEach(ActivityType.allCases) { t in
                        Label(t.label, systemImage: t.systemImage).tag(t)
                    }
                }
                TextField("Time", text: $time)
                TextField("Name", text: $name)
                TextField("Description", text: $descriptionText, axis: .vertical)
                    .lineLimit(3 ... 6)
                TextField("Location", text: $location)
                TextField("Cost", text: $cost)
                Toggle("Rating (0–10)", isOn: $useRating)
                if useRating {
                    Slider(value: $rating, in: 0 ... 10, step: 0.5)
                    Text(String(format: "%.1f", rating))
                }
                Section("Geocode (Nominatim)") {
                    HStack {
                        TextField("Search place", text: $geocodeQuery)
                        Button("Search") { runGeocode() }
                            .disabled(geocodeQuery.count < 2 || isSearching)
                    }
                    if isSearching {
                        ProgressView()
                    }
                    ForEach(geocodeResults) { place in
                        Button {
                            location = place.displayName
                            coordinates = [place.latitude, place.longitude]
                        } label: {
                            VStack(alignment: .leading) {
                                Text(place.displayName)
                                    .font(.subheadline)
                                    .foregroundStyle(ShellChrome.ink)
                            }
                        }
                    }
                    if coordinates != nil {
                        Text("Coordinates set")
                            .font(.caption)
                            .foregroundStyle(ShellChrome.accent)
                    }
                }
            }
            .navigationTitle(isEdit ? "Edit activity" : "Add activity")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if isEdit, onDelete != nil {
                    ToolbarItem(placement: .bottomBar) {
                        Button("Delete", role: .destructive) {
                            onDelete?()
                            dismiss()
                        }
                    }
                }
            }
        }
    }

    private var isEdit: Bool {
        if case .edit = mode { return true }
        return false
    }

    private func save() {
        var activity = Activity(
            time: time,
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            description: descriptionText,
            type: type,
            location: location.isEmpty ? nil : location,
            cost: cost.isEmpty ? nil : cost,
            rating: useRating ? rating : nil,
            coordinates: coordinates,
            moodVotes: nil,
            voiceNote: nil
        )
        if case .edit(let existing) = mode {
            activity.moodVotes = existing.moodVotes
            activity.voiceNote = existing.voiceNote
        }
        onSave(activity)
        dismiss()
    }

    private func runGeocode() {
        isSearching = true
        Task {
            defer { isSearching = false }
            geocodeResults = (try? await NominatimClient.search(query: geocodeQuery)) ?? []
        }
    }
}

// MARK: - Mood board

struct MoodBoardSheet: View {
    let initial: MoodVotes
    let onSave: (MoodVotes) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var votes: MoodVotes
    @State private var commentAuthor: TravelerId = .traveler1

    init(initial: MoodVotes, onSave: @escaping (MoodVotes) -> Void) {
        self.initial = initial
        self.onSave = onSave
        _votes = State(initialValue: initial)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Traveler 1") {
                    reactionGrid(selected: votes.traveler1) { votes.traveler1 = $0 }
                }
                Section("Traveler 2") {
                    reactionGrid(selected: votes.traveler2) { votes.traveler2 = $0 }
                }
                Section("Comment") {
                    Picker("By", selection: $commentAuthor) {
                        Text("Traveler 1").tag(TravelerId.traveler1)
                        Text("Traveler 2").tag(TravelerId.traveler2)
                    }
                    TextField("Note", text: Binding(
                        get: { votes.comment ?? "" },
                        set: { votes.comment = $0.isEmpty ? nil : $0; votes.commentBy = commentAuthor }
                    ), axis: .vertical)
                }
            }
            .navigationTitle("Mood board")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(votes)
                        dismiss()
                    }
                }
            }
        }
    }

    private func reactionGrid(selected: MoodReaction?, onPick: @escaping (MoodReaction?) -> Void) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 88))], spacing: 8) {
            ForEach(MoodReaction.allCases, id: \.self) { reaction in
                Button {
                    onPick(selected == reaction ? nil : reaction)
                } label: {
                    VStack(spacing: 4) {
                        Text(reaction.emoji).font(.title2)
                        Text(reaction.label)
                            .font(.caption2)
                            .multilineTextAlignment(.center)
                    }
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(selected == reaction ? ShellChrome.accentSoft : ShellChrome.background)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }
}

// MARK: - Food picker

struct FoodPickerSheet: View {
    let city: String
    let onAdd: (Activity) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var mode: FoodGems.FoodPickerMode = .local
    @State private var spinResult: FoodGems.Entry?
    @State private var spinTime = "12:30"

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("City: \(city.isEmpty ? "Anywhere" : city)")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
                Picker("Mode", selection: $mode) {
                    ForEach(FoodGems.FoodPickerMode.allCases) { m in
                        Text(m.label).tag(m)
                    }
                }
                .pickerStyle(.segmented)
                TextField("Time", text: $spinTime)
                    .textFieldStyle(.roundedBorder)
                PillButton(title: "Spin", systemImage: "dice", kind: .primary) {
                    let picks = FoodGems.picks(for: city, mode: mode)
                    spinResult = picks.randomElement()
                }
                if let spinResult {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(spinResult.name)
                            .font(.title3.weight(.bold))
                        Text(spinResult.blurb)
                            .font(.subheadline)
                            .foregroundStyle(ShellChrome.inkMuted)
                        PillButton(title: "Add to day", systemImage: "plus", kind: .soft) {
                            onAdd(Activity(
                                time: spinTime,
                                name: spinResult.name,
                                description: spinResult.blurb,
                                type: .food,
                                location: city.isEmpty ? nil : city,
                                cost: nil,
                                rating: nil,
                                coordinates: nil,
                                moodVotes: nil,
                                voiceNote: nil
                            ))
                            dismiss()
                        }
                    }
                    .padding()
                    .shellCard()
                }
                Spacer()
            }
            .padding(20)
            .navigationTitle("Food picker")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }
}

// MARK: - Day photos

struct DayPhotoGallerySheet: View {
    @ObservedObject var session: TripSession
    let dayNumber: Int
    let onUpdate: ([DayPhoto]) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var photos: [DayPhoto] = []
    @State private var pickerItem: PhotosPickerItem?
    @State private var captionDraft = ""

    private var itineraryId: String? { session.activeItineraryId }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    PhotosPicker(selection: $pickerItem, matching: .images) {
                        Label("Add photo", systemImage: "photo.badge.plus")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(ShellChrome.accentSoft)
                            .clipShape(Capsule())
                    }
                    TextField("Caption for next photo", text: $captionDraft)
                        .textFieldStyle(.roundedBorder)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 120))], spacing: 12) {
                        ForEach(photos) { photo in
                            photoCell(photo)
                        }
                    }
                }
                .padding(20)
            }
            .navigationTitle("Day photos")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        onUpdate(photos)
                        dismiss()
                    }
                }
            }
            .onAppear { loadPhotos() }
            .onChange(of: pickerItem) { _, item in
                guard let item else { return }
                Task { await importPhoto(from: item) }
            }
        }
    }

    private func loadPhotos() {
        if let id = itineraryId {
            let stored = PhotoStore.shared.loadPhotos(itineraryId: id, dayNumber: dayNumber)
            if !stored.isEmpty {
                photos = stored
                return
            }
        }
        if let day = session.itinerary?.days.first(where: { $0.day == dayNumber }) {
            photos = day.photos ?? []
        }
    }

    private func photoCell(_ photo: DayPhoto) -> some View {
        VStack(spacing: 6) {
            if let data = DataURLHelper.data(from: photo.dataUrl),
               let ui = UIImage(data: data) {
                Image(uiImage: ui)
                    .resizable()
                    .scaledToFill()
                    .frame(height: 120)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            if let caption = photo.caption, !caption.isEmpty {
                Text(caption).font(.caption).lineLimit(2)
            }
            Button("Delete", role: .destructive) {
                deletePhoto(photo)
            }
            .font(.caption)
        }
    }

    private func importPhoto(from item: PhotosPickerItem) async {
        guard let id = itineraryId,
              let data = try? await item.loadTransferable(type: Data.self) else { return }
        do {
            let saved = try PhotoStore.shared.savePhoto(
                itineraryId: id,
                dayNumber: dayNumber,
                imageData: data,
                caption: captionDraft.isEmpty ? nil : captionDraft
            )
            photos.append(saved)
            captionDraft = ""
            pickerItem = nil
        } catch {
            let fallback = DayPhoto(
                id: "photo-\(UUID().uuidString.prefix(8))",
                dataUrl: DataURLHelper.jpegDataURL(data),
                caption: captionDraft.isEmpty ? nil : captionDraft,
                createdAt: ItineraryFormatting.isoNow()
            )
            photos.append(fallback)
            captionDraft = ""
            pickerItem = nil
        }
    }

    private func deletePhoto(_ photo: DayPhoto) {
        photos.removeAll { $0.id == photo.id }
        if let id = itineraryId {
            try? PhotoStore.shared.deletePhoto(itineraryId: id, dayNumber: dayNumber, photoId: photo.id)
        }
    }
}

// MARK: - Voice note

struct ActivityVoiceNoteControl: View {
    let voiceNote: VoiceNote?
    let onSave: (VoiceNote) -> Void
    let onClear: () -> Void

    @StateObject private var recorder = VoiceNoteRecorder()
    @State private var player: AVAudioPlayer?

    var body: some View {
        HStack(spacing: 6) {
            if recorder.isRecording {
                CompactPillButton(title: "Stop", systemImage: "stop.fill", kind: .primary) {
                    if let note = recorder.stopRecording() {
                        onSave(note)
                    }
                }
            } else {
                CompactPillButton(title: voiceNote == nil ? "Record" : "Re-record", systemImage: "mic.fill", kind: .soft) {
                    recorder.startRecording()
                }
            }
            if voiceNote != nil {
                CompactPillButton(title: "Play", systemImage: "play.fill", kind: .soft) {
                    playNote()
                }
                CompactPillButton(title: "Clear", kind: .soft) {
                    onClear()
                }
            }
        }
    }

    private func playNote() {
        guard let voiceNote,
              let data = DataURLHelper.data(from: voiceNote.dataUrl) else { return }
        player = try? AVAudioPlayer(data: data)
        player?.play()
    }
}

@MainActor
final class VoiceNoteRecorder: ObservableObject {
    @Published var isRecording = false
    private var recorder: AVAudioRecorder?
    private var startedAt: Date?
    private var fileURL: URL?

    func startRecording() {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            Task { @MainActor in
                guard granted else { return }
                self.beginCapture()
            }
        }
    }

    private func beginCapture() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
        try? session.setActive(true)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        fileURL = url
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]
        recorder = try? AVAudioRecorder(url: url, settings: settings)
        recorder?.record()
        startedAt = Date()
        isRecording = true
    }

    func stopRecording() -> VoiceNote? {
        recorder?.stop()
        isRecording = false
        defer {
            recorder = nil
            try? AVAudioSession.sharedInstance().setActive(false)
        }
        guard let url = fileURL,
              let data = try? Data(contentsOf: url) else { return nil }
        let duration = Date().timeIntervalSince(startedAt ?? Date())
        return VoiceNote(
            dataUrl: DataURLHelper.m4aDataURL(data),
            durationSec: duration,
            createdAt: ItineraryFormatting.isoNow()
        )
    }
}
