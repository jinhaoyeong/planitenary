import Foundation
import UIKit

struct StoredPhotoEntry: Codable {
    let key: String
    let dayKey: String
    var photo: DayPhoto
}

final class PhotoStore {
    static let shared = PhotoStore()

    private let fileManager = FileManager.default
    private let indexFileName = "index.json"
    private lazy var rootDirectory: URL = {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let folder = documents.appendingPathComponent("TravelHandbookPhotos", isDirectory: true)
        if !fileManager.fileExists(atPath: folder.path) {
            try? fileManager.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        return folder
    }()

    private init() {}

    func dayKey(itineraryId: String, dayNumber: Int) -> String {
        "\(itineraryId)-\(dayNumber)"
    }

    func photoKey(itineraryId: String, dayNumber: Int, photoId: String) -> String {
        "\(dayKey(itineraryId: itineraryId, dayNumber: dayNumber))-\(photoId)"
    }

    func loadPhotos(itineraryId: String, dayNumber: Int) -> [DayPhoto] {
        let prefix = dayKey(itineraryId: itineraryId, dayNumber: dayNumber)
        return loadIndex()
            .filter { $0.dayKey == prefix }
            .compactMap { hydratePhoto(from: $0) }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func loadAllPhotos(itineraryId: String) -> [Int: [DayPhoto]] {
        var grouped: [Int: [DayPhoto]] = [:]
        for entry in loadIndex().filter({ $0.dayKey.hasPrefix("\(itineraryId)-") }) {
            guard let dayNumber = parseDayNumber(from: entry.dayKey, itineraryId: itineraryId),
                  let photo = hydratePhoto(from: entry)
            else { continue }
            grouped[dayNumber, default: []].append(photo)
        }
        for key in grouped.keys {
            grouped[key]?.sort { $0.createdAt < $1.createdAt }
        }
        return grouped
    }

    @discardableResult
    func savePhoto(
        itineraryId: String,
        dayNumber: Int,
        imageData: Data,
        photoId: String? = nil,
        caption: String? = nil
    ) throws -> DayPhoto {
        let id = photoId ?? "photo-\(Int(Date().timeIntervalSince1970 * 1000))-\(UUID().uuidString.prefix(8))"
        let now = ISO8601DateFormatter().string(from: Date())
        let key = photoKey(itineraryId: itineraryId, dayNumber: dayNumber, photoId: id)
        let day = dayKey(itineraryId: itineraryId, dayNumber: dayNumber)

        let imageURL = imageFileURL(for: key)
        try imageData.write(to: imageURL, options: .atomic)

        let mime = imageData.isPNG ? "image/png" : "image/jpeg"
        let dataURL = "data:\(mime);base64,\(imageData.base64EncodedString())"
        var photo = DayPhoto(id: id, dataUrl: dataURL, caption: caption, createdAt: now)

        if let fileDataURL = try? dataURLFromFile(at: imageURL, mime: mime) {
            photo = DayPhoto(id: id, dataUrl: fileDataURL, caption: caption, createdAt: now)
        }

        var index = loadIndex()
        index.removeAll { $0.key == key }
        index.append(StoredPhotoEntry(key: key, dayKey: day, photo: photo))
        try persistIndex(index)
        return photo
    }

    func updatePhotoCaption(
        itineraryId: String,
        dayNumber: Int,
        photoId: String,
        caption: String?
    ) throws {
        let key = photoKey(itineraryId: itineraryId, dayNumber: dayNumber, photoId: photoId)
        var index = loadIndex()
        guard let entryIndex = index.firstIndex(where: { $0.key == key }) else { return }
        index[entryIndex].photo = DayPhoto(
            id: index[entryIndex].photo.id,
            dataUrl: index[entryIndex].photo.dataUrl,
            caption: caption?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == true ? nil : caption,
            createdAt: index[entryIndex].photo.createdAt
        )
        try persistIndex(index)
    }

    func deletePhoto(itineraryId: String, dayNumber: Int, photoId: String) throws {
        let key = photoKey(itineraryId: itineraryId, dayNumber: dayNumber, photoId: photoId)
        if fileManager.fileExists(atPath: imageFileURL(for: key).path) {
            try fileManager.removeItem(at: imageFileURL(for: key))
        }
        var index = loadIndex()
        index.removeAll { $0.key == key }
        try persistIndex(index)
    }

    func restorePhotos(for itineraryId: String) -> [Int: [DayPhoto]] {
        loadAllPhotos(itineraryId: itineraryId)
    }

    func deleteAllPhotos(itineraryId: String) throws {
        let remaining = loadIndex().filter { entry in
            if entry.dayKey.hasPrefix("\(itineraryId)-") {
                try? fileManager.removeItem(at: imageFileURL(for: entry.key))
                return false
            }
            return true
        }
        try persistIndex(remaining)
    }

    // MARK: - Private

    private func loadIndex() -> [StoredPhotoEntry] {
        let url = rootDirectory.appendingPathComponent(indexFileName)
        guard let data = try? Data(contentsOf: url) else { return [] }
        return (try? JSONDecoder().decode([StoredPhotoEntry].self, from: data)) ?? []
    }

    private func persistIndex(_ entries: [StoredPhotoEntry]) throws {
        let url = rootDirectory.appendingPathComponent(indexFileName)
        let data = try JSONEncoder().encode(entries)
        try data.write(to: url, options: .atomic)
    }

    private func imageFileURL(for key: String) -> URL {
        rootDirectory.appendingPathComponent("\(key).jpg")
    }

    private func hydratePhoto(from entry: StoredPhotoEntry) -> DayPhoto? {
        let fileURL = imageFileURL(for: entry.key)
        if fileManager.fileExists(atPath: fileURL.path),
           let dataURL = try? dataURLFromFile(at: fileURL, mime: "image/jpeg") {
            return DayPhoto(
                id: entry.photo.id,
                dataUrl: dataURL,
                caption: entry.photo.caption,
                createdAt: entry.photo.createdAt
            )
        }
        return entry.photo
    }

    private func dataURLFromFile(at url: URL, mime: String) throws -> String {
        let data = try Data(contentsOf: url)
        return "data:\(mime);base64,\(data.base64EncodedString())"
    }

    private func parseDayNumber(from dayKey: String, itineraryId: String) -> Int? {
        let prefix = "\(itineraryId)-"
        guard dayKey.hasPrefix(prefix) else { return nil }
        return Int(dayKey.dropFirst(prefix.count))
    }
}

private extension Data {
    var isPNG: Bool {
        count >= 8 && self.prefix(8) == Data([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    }
}
