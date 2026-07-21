import Foundation
import CoreLocation

struct NominatimPlace: Identifiable, Equatable, Hashable {
    let id: String
    let displayName: String
    let latitude: Double
    let longitude: Double
}

enum NominatimClient {
    private static let userAgent = "TravelHandbook-iOS/1.0 (itinerary-planner)"

    static func search(query: String, limit: Int = 8) async throws -> [NominatimPlace] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return [] }

        var components = URLComponents(string: "https://nominatim.openstreetmap.org/search")!
        components.queryItems = [
            URLQueryItem(name: "q", value: trimmed),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "limit", value: String(limit)),
            URLQueryItem(name: "addressdetails", value: "0"),
        ]
        guard let url = components.url else { return [] }

        var request = URLRequest(url: url)
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            return []
        }

        struct Row: Decodable {
            let place_id: Int
            let display_name: String
            let lat: String
            let lon: String
        }

        let rows = try JSONDecoder().decode([Row].self, from: data)
        return rows.compactMap { row in
            guard let lat = Double(row.lat), let lon = Double(row.lon) else { return nil }
            return NominatimPlace(
                id: String(row.place_id),
                displayName: row.display_name,
                latitude: lat,
                longitude: lon
            )
        }
    }
}

enum CityCenters {
    static let coordinates: [String: CLLocationCoordinate2D] = [
        "Tokyo": .init(latitude: 35.6762, longitude: 139.6503),
        "Osaka": .init(latitude: 34.6937, longitude: 135.5023),
        "Kyoto": .init(latitude: 35.0116, longitude: 135.7681),
        "Seoul": .init(latitude: 37.5665, longitude: 126.9780),
        "Bangkok": .init(latitude: 13.7563, longitude: 100.5018),
        "Singapore": .init(latitude: 1.3521, longitude: 103.8198),
        "Kuala Lumpur": .init(latitude: 3.1390, longitude: 101.6869),
        "Hong Kong": .init(latitude: 22.3193, longitude: 114.1694),
        "Taipei": .init(latitude: 25.0330, longitude: 121.5654),
        "Paris": .init(latitude: 48.8566, longitude: 2.3522),
        "London": .init(latitude: 51.5074, longitude: -0.1278),
        "New York": .init(latitude: 40.7128, longitude: -74.0060),
        "Los Angeles": .init(latitude: 34.0522, longitude: -118.2437),
        "Barcelona": .init(latitude: 41.3874, longitude: 2.1686),
        "Rome": .init(latitude: 41.9028, longitude: 12.4964),
        "Dubai": .init(latitude: 25.2048, longitude: 55.2708),
        "Sydney": .init(latitude: -33.8688, longitude: 151.2093),
        "Melbourne": .init(latitude: -37.8136, longitude: 144.9631),
    ]

    static func coordinate(for city: String) -> CLLocationCoordinate2D? {
        let key = city.trimmingCharacters(in: .whitespacesAndNewlines)
        if let exact = coordinates[key] { return exact }
        let lower = key.lowercased()
        return coordinates.first { $0.key.lowercased() == lower }?.value
    }
}
