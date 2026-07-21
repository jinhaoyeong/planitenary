// Info.plist: NSLocationWhenInUseUsageDescription — show activity pins on the map (optional).

import MapKit
import SwiftUI

struct MapActivityPin: Identifiable, Hashable {
    let id: String
    let dayNumber: Int
    let activityIndex: Int
    let name: String
    let city: String
    let type: ActivityType
    let coordinate: CLLocationCoordinate2D
}

struct MapsView: View {
    @ObservedObject var session: TripSession

    @State private var selectedCity = "All"
    @State private var selectedType: ActivityType?
    @State private var mapPosition: MapCameraPosition = .automatic
    @State private var searchQuery = ""
    @State private var searchResults: [NominatimPlace] = []
    @State private var isSearching = false
    @State private var addPlace: NominatimPlace?
    @State private var editingPin: MapActivityPin?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            SectionHeader(eyebrow: "Maps", title: "Trip map")
            filters
            searchBar
            mapSection
            locationsList
        }
        .padding(20)
        .onAppear { fitMapToPins() }
        .onChange(of: filteredPins.count) { _, _ in fitMapToPins() }
        .sheet(item: $addPlace) { place in
            AddPlaceToItinerarySheet(session: session, place: place)
        }
        .sheet(item: $editingPin) { pin in
            if let activity = activity(for: pin) {
                ActivityFormSheet(mode: .edit(activity)) { updated in
                    updateActivity(pin: pin, with: updated)
                } onDelete: {
                    deleteActivity(pin: pin)
                }
            }
        }
    }

    private var cities: [String] {
        var set = Set<String>()
        for day in session.itinerary?.days ?? [] {
            if !day.city.isEmpty { set.insert(day.city) }
        }
        return ["All"] + set.sorted()
    }

    private var allPins: [MapActivityPin] {
        guard let itinerary = session.itinerary else { return [] }
        var pins: [MapActivityPin] = []
        for day in itinerary.days {
            for (index, activity) in day.activities.enumerated() {
                guard let coord = coordinate(for: activity, city: day.city) else { continue }
                pins.append(
                    MapActivityPin(
                        id: "\(day.day)-\(index)-\(activity.name)",
                        dayNumber: day.day,
                        activityIndex: index,
                        name: activity.name,
                        city: day.city,
                        type: activity.type,
                        coordinate: coord
                    )
                )
            }
        }
        return pins
    }

    private var filteredPins: [MapActivityPin] {
        allPins.filter { pin in
            let cityOK = selectedCity == "All" || pin.city == selectedCity
            let typeOK = selectedType == nil || pin.type == selectedType
            return cityOK && typeOK
        }
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(cities, id: \.self) { city in
                        filterChip(title: city, isSelected: selectedCity == city) {
                            selectedCity = city
                        }
                    }
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    filterChip(title: "All types", isSelected: selectedType == nil) {
                        selectedType = nil
                    }
                    ForEach(ActivityType.allCases) { type in
                        filterChip(title: type.label, isSelected: selectedType == type) {
                            selectedType = type
                        }
                    }
                }
            }
        }
    }

    private func filterChip(title: String, isSelected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.caption.weight(.semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .foregroundStyle(isSelected ? Color.white : ShellChrome.ink)
                .background(isSelected ? ShellChrome.accent : ShellChrome.accentSoft)
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    private var searchBar: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Search places (Nominatim)", text: $searchQuery)
                    .textFieldStyle(.roundedBorder)
                Button("Go") { runSearch() }
                    .disabled(searchQuery.count < 2 || isSearching)
            }
            if isSearching { ProgressView() }
            ForEach(searchResults) { place in
                Button {
                    addPlace = place
                } label: {
                    Text(place.displayName)
                        .font(.caption)
                        .foregroundStyle(ShellChrome.ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                        .background(ShellChrome.cardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var mapSection: some View {
        Map(position: $mapPosition, selection: $editingPin) {
            ForEach(filteredPins) { pin in
                Marker(pin.name, systemImage: pin.type.systemImage, coordinate: pin.coordinate)
                    .tag(pin)
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .frame(height: 280)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(ShellChrome.border, lineWidth: 1)
        )
    }

    private var locationsList: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Locations")
                .font(.headline)
            if filteredPins.isEmpty {
                Text("No pins yet — geocode activities or search to add places.")
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            } else {
                ForEach(filteredPins) { pin in
                    Button {
                        editingPin = pin
                        mapPosition = .region(MKCoordinateRegion(
                            center: pin.coordinate,
                            span: MKCoordinateSpan(latitudeDelta: 0.05, longitudeDelta: 0.05)
                        ))
                    } label: {
                        HStack {
                            Image(systemName: pin.type.systemImage)
                                .foregroundStyle(ShellChrome.accent)
                            VStack(alignment: .leading) {
                                Text(pin.name).font(.subheadline.weight(.semibold))
                                Text("Day \(pin.dayNumber) · \(pin.city)")
                                    .font(.caption)
                                    .foregroundStyle(ShellChrome.inkMuted)
                            }
                            Spacer()
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(ShellChrome.inkMuted)
                        }
                        .padding(14)
                        .shellCard()
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func coordinate(for activity: Activity, city: String) -> CLLocationCoordinate2D? {
        if let coords = activity.coordinates, coords.count >= 2 {
            return CLLocationCoordinate2D(latitude: coords[0], longitude: coords[1])
        }
        return CityCenters.coordinate(for: city)
    }

    private func fitMapToPins() {
        let pins = filteredPins
        guard !pins.isEmpty else {
            mapPosition = .region(MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 35.6762, longitude: 139.6503),
                span: MKCoordinateSpan(latitudeDelta: 8, longitudeDelta: 8)
            ))
            return
        }
        let lats = pins.map(\.coordinate.latitude)
        let lons = pins.map(\.coordinate.longitude)
        let center = CLLocationCoordinate2D(
            latitude: (lats.min()! + lats.max()!) / 2,
            longitude: (lons.min()! + lons.max()!) / 2
        )
        let span = MKCoordinateSpan(
            latitudeDelta: max(0.08, (lats.max()! - lats.min()!) * 1.4 + 0.02),
            longitudeDelta: max(0.08, (lons.max()! - lons.min()!) * 1.4 + 0.02)
        )
        mapPosition = .region(MKCoordinateRegion(center: center, span: span))
    }

    private func runSearch() {
        isSearching = true
        Task {
            defer { isSearching = false }
            searchResults = (try? await NominatimClient.search(query: searchQuery)) ?? []
        }
    }

    private func activity(for pin: MapActivityPin) -> Activity? {
        guard let day = session.itinerary?.days.first(where: { $0.day == pin.dayNumber }),
              day.activities.indices.contains(pin.activityIndex) else { return nil }
        return day.activities[pin.activityIndex]
    }

    private func updateActivity(pin: MapActivityPin, with activity: Activity) {
        session.updateItinerary { itinerary in
            guard let dayIdx = itinerary.days.firstIndex(where: { $0.day == pin.dayNumber }),
                  itinerary.days[dayIdx].activities.indices.contains(pin.activityIndex) else { return }
            itinerary.days[dayIdx].activities[pin.activityIndex] = activity
        }
    }

    private func deleteActivity(pin: MapActivityPin) {
        session.updateItinerary { itinerary in
            guard let dayIdx = itinerary.days.firstIndex(where: { $0.day == pin.dayNumber }),
                  itinerary.days[dayIdx].activities.indices.contains(pin.activityIndex) else { return }
            itinerary.days[dayIdx].activities.remove(at: pin.activityIndex)
        }
    }
}

struct AddPlaceToItinerarySheet: View {
    @ObservedObject var session: TripSession
    let place: NominatimPlace

    @Environment(\.dismiss) private var dismiss
    @State private var dayNumber = 1
    @State private var type: ActivityType = .sight
    @State private var time = "10:00"
    @State private var cost = ""
    @State private var notes = ""

    var body: some View {
        NavigationStack {
            Form {
                Text(place.displayName)
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
                Picker("Day", selection: $dayNumber) {
                    ForEach(session.itinerary?.days ?? [], id: \.day) { day in
                        Text("Day \(day.day): \(day.title)").tag(day.day)
                    }
                }
                Picker("Type", selection: $type) {
                    ForEach(ActivityType.allCases) { t in
                        Text(t.label).tag(t)
                    }
                }
                TextField("Time", text: $time)
                TextField("Cost", text: $cost)
                TextField("Notes", text: $notes, axis: .vertical)
            }
            .navigationTitle("Add to itinerary")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        add()
                        dismiss()
                    }
                }
            }
            .onAppear {
                dayNumber = session.itinerary?.days.first?.day ?? 1
            }
        }
    }

    private func add() {
        let activity = Activity(
            time: time,
            name: place.displayName.components(separatedBy: ",").first ?? place.displayName,
            description: notes,
            type: type,
            location: place.displayName,
            cost: cost.isEmpty ? nil : cost,
            rating: nil,
            coordinates: [place.latitude, place.longitude],
            moodVotes: nil,
            voiceNote: nil
        )
        session.updateItinerary { itinerary in
            guard let idx = itinerary.days.firstIndex(where: { $0.day == dayNumber }) else { return }
            itinerary.days[idx].activities.append(activity)
        }
    }
}
