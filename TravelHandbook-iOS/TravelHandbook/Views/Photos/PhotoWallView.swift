import PhotosUI
import SwiftUI
import UIKit

private struct FlatPhoto: Identifiable {
    let id: String
    let photo: DayPhoto
    let dayNumber: Int
    let dayTitle: String
}

struct PhotoWallView: View {
    @ObservedObject var session: TripSession

    @State private var photosByDay: [Int: [DayPhoto]] = [:]
    @State private var showAddModal = false
    @State private var selectedDay = 1
    @State private var caption = ""
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isSaving = false
    @State private var showLightbox = false
    @State private var currentLightboxIndex = 0
    @State private var captionDraft = ""
    @State private var isEditingCaption = false

    private let maxSelection = 25
    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            if flatPhotos.isEmpty {
                EmptyState(
                    systemImage: "photo.on.rectangle.angled",
                    title: "Photo wall",
                    message: "Add photos by day to build your trip memories."
                )
                .padding(.vertical, 20)
            } else {
                daySections
            }
        }
        .padding(20)
        .onAppear { reloadPhotos() }
        .onChange(of: session.activeItineraryId) { _, _ in reloadPhotos() }
        .sheet(isPresented: $showAddModal) {
            addPhotoSheet
        }
        .fullScreenCover(isPresented: $showLightbox) {
            lightboxView
        }
    }

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(eyebrow: "Memories", title: "Photo wall")
                Text("\(flatPhotos.count) photo\(flatPhotos.count == 1 ? "" : "s") across your trip.")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            Spacer()
            CompactPillButton(title: "Add", systemImage: "plus", kind: .primary) {
                selectedDay = session.itinerary?.days.first?.day ?? 1
                showAddModal = true
            }
        }
    }

    private var daySections: some View {
        VStack(alignment: .leading, spacing: 24) {
            ForEach(sortedDayNumbers, id: \.self) { dayNumber in
                if let photos = photosByDay[dayNumber], !photos.isEmpty {
                    daySection(dayNumber: dayNumber, photos: photos)
                }
            }
        }
    }

    private func daySection(dayNumber: Int, photos: [DayPhoto]) -> some View {
        let day = session.itinerary?.days.first(where: { $0.day == dayNumber })
        let title = day.map { "Day \($0.day) · \($0.city)" } ?? "Day \(dayNumber)"
        return VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.headline)
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(Array(photos.enumerated()), id: \.element.id) { index, photo in
                    let globalIndex = flatPhotos.firstIndex(where: { $0.photo.id == photo.id && $0.dayNumber == dayNumber })
                    photoTile(photo: photo, stagger: index)
                        .onTapGesture {
                            if let globalIndex {
                                currentLightboxIndex = globalIndex
                                showLightbox = true
                            }
                        }
                }
            }
        }
    }

    private func photoTile(photo: DayPhoto, stagger: Int) -> some View {
        let heights: [CGFloat] = [160, 200, 140]
        return Group {
            if let image = MediaDataURL.image(from: photo.dataUrl) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Rectangle().fill(ShellChrome.border)
            }
        }
        .frame(height: heights[stagger % heights.count])
        .frame(maxWidth: .infinity)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(alignment: .bottomLeading) {
            if let caption = photo.caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.white)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .top, endPoint: .bottom)
                    )
            }
        }
    }

    private var addPhotoSheet: some View {
        NavigationStack {
            Form {
                if let days = session.itinerary?.days, !days.isEmpty {
                    Picker("Day", selection: $selectedDay) {
                        ForEach(days, id: \.day) { day in
                            Text("Day \(day.day) · \(day.city)").tag(day.day)
                        }
                    }
                }
                Section("Photos (up to \(maxSelection))") {
                    PhotosPicker(
                        selection: $pickerItems,
                        maxSelectionCount: maxSelection,
                        matching: .images
                    ) {
                        Label("Choose images", systemImage: "photo.on.rectangle")
                    }
                    Text("\(pickerItems.count) selected")
                        .font(.caption)
                        .foregroundStyle(ShellChrome.inkMuted)
                }
                Section("Caption") {
                    TextField("Optional caption for this batch", text: $caption)
                }
            }
            .navigationTitle("Add photos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        resetAddModal()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task { await savePhotos() }
                    }
                    .disabled(pickerItems.isEmpty || isSaving)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var lightboxView: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $currentLightboxIndex) {
                ForEach(Array(flatPhotos.enumerated()), id: \.element.id) { index, entry in
                    lightboxPage(entry, index: index)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .automatic))
            VStack {
                HStack {
                    Spacer()
                    Button {
                        showLightbox = false
                        isEditingCaption = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.title)
                            .foregroundStyle(.white.opacity(0.9))
                    }
                    .padding()
                }
                Spacer()
            }
        }
    }

    private func lightboxPage(_ entry: FlatPhoto, index: Int) -> some View {
        VStack(spacing: 16) {
            Spacer()
            if let image = MediaDataURL.image(from: entry.photo.dataUrl) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .padding(.horizontal, 12)
            }
            VStack(spacing: 8) {
                Text(entry.dayTitle)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.8))
                if isEditingCaption, currentLightboxIndex == index {
                    TextField("Caption", text: $captionDraft)
                        .textFieldStyle(.roundedBorder)
                        .padding(.horizontal, 20)
                    HStack {
                        Button("Save") { saveCaption(for: entry) }
                        Button("Cancel") { isEditingCaption = false }
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Text(entry.photo.caption ?? "No caption")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 20)
                }
            }
            HStack(spacing: 20) {
                Button {
                    captionDraft = entry.photo.caption ?? ""
                    isEditingCaption = true
                } label: {
                    Label("Edit caption", systemImage: "text.quote")
                }
                Button(role: .destructive) {
                    deletePhoto(entry)
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.bottom, 32)
        }
    }

    private var flatPhotos: [FlatPhoto] {
        sortedDayNumbers.flatMap { dayNumber -> [FlatPhoto] in
            let photos = photosByDay[dayNumber] ?? []
            let day = session.itinerary?.days.first(where: { $0.day == dayNumber })
            let title = day.map { "Day \($0.day) · \($0.date)" } ?? "Day \(dayNumber)"
            return photos.map {
                FlatPhoto(id: "\(dayNumber)-\($0.id)", photo: $0, dayNumber: dayNumber, dayTitle: title)
            }
        }
    }

    private var sortedDayNumbers: [Int] {
        photosByDay.keys.sorted()
    }

    private func reloadPhotos() {
        guard let id = session.activeItineraryId else {
            photosByDay = [:]
            return
        }
        photosByDay = PhotoStore.shared.loadAllPhotos(itineraryId: id)
    }

    private func savePhotos() async {
        guard let itineraryId = session.activeItineraryId else { return }
        isSaving = true
        defer { isSaving = false }
        let trimmedCaption = caption.trimmingCharacters(in: .whitespacesAndNewlines)
        let batchCaption = trimmedCaption.isEmpty ? nil : trimmedCaption
        for item in pickerItems {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            _ = try? PhotoStore.shared.savePhoto(
                itineraryId: itineraryId,
                dayNumber: selectedDay,
                imageData: data,
                caption: batchCaption
            )
        }
        reloadPhotos()
        resetAddModal()
    }

    private func resetAddModal() {
        showAddModal = false
        pickerItems = []
        caption = ""
    }

    private func saveCaption(for entry: FlatPhoto) {
        guard let itineraryId = session.activeItineraryId else { return }
        try? PhotoStore.shared.updatePhotoCaption(
            itineraryId: itineraryId,
            dayNumber: entry.dayNumber,
            photoId: entry.photo.id,
            caption: captionDraft
        )
        isEditingCaption = false
        reloadPhotos()
    }

    private func deletePhoto(_ entry: FlatPhoto) {
        guard let itineraryId = session.activeItineraryId else { return }
        try? PhotoStore.shared.deletePhoto(
            itineraryId: itineraryId,
            dayNumber: entry.dayNumber,
            photoId: entry.photo.id
        )
        showLightbox = false
        reloadPhotos()
    }
}

private enum MediaDataURL {
    static func image(from dataUrl: String) -> UIImage? {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let encoded = String(dataUrl[dataUrl.index(after: comma)...])
        guard let data = Data(base64Encoded: encoded) else { return nil }
        return UIImage(data: data)
    }
}
