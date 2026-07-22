import SwiftUI

struct ItineraryHomeView: View {
    @ObservedObject var session: TripSession

    @State private var isEditingPlanName = false
    @State private var planNameDraft = ""
    @State private var isEditMode = false
    @State private var showResetConfirm = false
    @State private var navigationDay: DayNavigationTarget?
    @State private var searchText = ""

    private var labels: TripCopyLabels { session.tripSettings.labels }

    private var filteredDays: [DayPlan] {
        let days = session.itinerary?.days ?? []
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return days }
        return days.filter { day in
            day.title.lowercased().contains(query)
                || day.city.lowercased().contains(query)
                || day.date.lowercased().contains(query)
                || day.activities.contains {
                    $0.name.lowercased().contains(query)
                        || ($0.location?.lowercased().contains(query) ?? false)
                        || $0.description.lowercased().contains(query)
                }
        }
    }

    private var overviewIntro: String {
        let cities = session.itinerary?.cities ?? []
        if cities.isEmpty {
            return labels.overviewIntroEmpty
        }
        return applyTemplate(labels.overviewIntroFilled, replacements: [
            "cities": cities.joined(separator: " & "),
        ])
    }

    var body: some View {
        NavigationStack {
            Group {
                if session.itinerary == nil {
                    EmptyState(
                        systemImage: "calendar",
                        title: "No itinerary",
                        message: "Open a trip from the dashboard to start planning."
                    )
                } else {
                    itineraryContent
                }
            }
            .navigationDestination(item: $navigationDay) { target in
                DayDetailView(session: session, dayNumber: target.day)
            }
        }
    }

    private var itineraryContent: some View {
        VStack(alignment: .leading, spacing: 20) {
            planHeader
            searchField
            editToolbar
            daysList
        }
        .padding(20)
        .alert("Reset plan?", isPresented: $showResetConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) { resetPlan() }
        } message: {
            Text("This replaces all days and activities with a fresh starter plan. This cannot be undone.")
        }
    }

    private var planHeader: some View {
        VStack(alignment: .leading, spacing: 14) {
            EditorialPageHeader(
                eyebrow: labels.overviewEyebrow,
                titleLeading: Self.splitName(session.tripDisplayName).leading,
                titleAccent: Self.splitName(session.tripDisplayName).accent,
                subtitle: overviewIntro,
                centered: false,
                titleSize: 36
            )

            if isEditingPlanName {
                HStack(spacing: 10) {
                    TextField("Plan name", text: $planNameDraft)
                        .textFieldStyle(.roundedBorder)
                    CompactPillButton(title: "Save", kind: .primary) {
                        session.renameTrip(to: planNameDraft)
                        isEditingPlanName = false
                    }
                }
            } else {
                Button {
                    planNameDraft = session.tripDisplayName
                    isEditingPlanName = true
                } label: {
                    Label("Edit plan name", systemImage: "pencil")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(ShellChrome.accent)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private static func splitName(_ name: String) -> (leading: String, accent: String) {
        let parts = name.split(separator: " ").map(String.init)
        guard parts.count > 1 else { return ("", name) }
        return (parts.dropLast().joined(separator: " "), parts.last!)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(ShellChrome.inkMuted)
            TextField(labels.searchPlaceholder, text: $searchText)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(ShellChrome.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(ShellChrome.border, lineWidth: 1)
        )
    }

    private var editToolbar: some View {
        HStack(spacing: 10) {
            CompactPillButton(
                title: isEditMode ? labels.doneCustomizing : labels.customizePlan,
                systemImage: isEditMode ? "checkmark" : "slider.horizontal.3",
                kind: isEditMode ? .primary : .soft
            ) {
                withAnimation { isEditMode.toggle() }
            }

            if isEditMode {
                CompactPillButton(title: "Add Day", systemImage: "plus", kind: .soft) {
                    addDay()
                }
                CompactPillButton(title: labels.resetPlan, systemImage: "arrow.counterclockwise", kind: .soft) {
                    showResetConfirm = true
                }
            }
        }
    }

    private var daysList: some View {
        Group {
            if filteredDays.isEmpty {
                EmptyState(
                    systemImage: "calendar.badge.plus",
                    title: searchText.isEmpty ? "Day 1 is ready" : "No matching days",
                    message: searchText.isEmpty
                        ? "Tap Customize Plan to add days, or open Day 1 and start adding activities, places, and notes."
                        : "Try a different search term."
                )
                .padding(.top, 12)
            } else {
                List {
                    ForEach(filteredDays) { day in
                        dayCard(day)
                            .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color.clear)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                guard !isEditMode else { return }
                                navigationDay = DayNavigationTarget(day: day.day)
                            }
                    }
                    .onMove(perform: isEditMode && searchText.isEmpty ? moveDays : nil)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .environment(\.editMode, .constant(isEditMode ? EditMode.active : EditMode.inactive))
                .frame(minHeight: CGFloat(max(filteredDays.count, 1) * 120))
            }
        }
    }

    private func dayCard(_ day: DayPlan) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(String(format: "%02d", day.day))
                    .font(.system(size: 44, weight: .regular, design: .serif))
                    .foregroundStyle(ShellChrome.accent)
                Spacer()
                Text(day.date.uppercased())
                    .font(.caption2.weight(.bold))
                    .tracking(1.4)
                    .foregroundStyle(ShellChrome.inkMuted)
            }

            Text(day.title)
                .font(.system(size: 24, weight: .regular, design: .serif))
                .foregroundStyle(ShellChrome.ink)

            HStack(spacing: 16) {
                Label(day.city, systemImage: "mappin.and.ellipse")
                Spacer()
                Label("\(day.activities.count) \(labels.spotsSuffix)", systemImage: "fork.knife")
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(ShellChrome.inkMuted)
        }
        .padding(20)
        .shellCard()
    }

    private func addDay() {
        session.updateItinerary { itinerary in
            let next = (itinerary.days.map(\.day).max() ?? 0) + 1
            itinerary.days.append(
                DayPlan(
                    day: next,
                    date: "Add date",
                    city: itinerary.cities.first ?? "Add city",
                    title: "Day \(next)",
                    activities: [],
                    photos: nil
                )
            )
            renumberDays(&itinerary)
        }
    }

    private func moveDays(from source: IndexSet, to destination: Int) {
        session.updateItinerary { itinerary in
            itinerary.days.move(fromOffsets: source, toOffset: destination)
            renumberDays(&itinerary)
        }
    }

    private func renumberDays(_ itinerary: inout Itinerary) {
        for index in itinerary.days.indices {
            itinerary.days[index].day = index + 1
        }
    }

    private func resetPlan() {
        guard let id = session.itinerary?.id else { return }
        session.updateItinerary { $0 = Itinerary.starter(id: id) }
        isEditMode = false
    }
}

struct DayNavigationTarget: Hashable, Identifiable {
    let day: Int
    var id: Int { day }
}
