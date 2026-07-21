import SwiftUI

struct ItineraryHomeView: View {
    @ObservedObject var session: TripSession

    @State private var isEditingPlanName = false
    @State private var planNameDraft = ""
    @State private var isEditMode = false
    @State private var showResetConfirm = false
    @State private var navigationDay: DayNavigationTarget?

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
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader(eyebrow: "Itinerary", title: session.tripDisplayName)

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

            if let description = session.itinerary?.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
        }
    }

    private var editToolbar: some View {
        HStack(spacing: 10) {
            CompactPillButton(
                title: isEditMode ? "Done" : "Customize",
                systemImage: isEditMode ? "checkmark" : "slider.horizontal.3",
                kind: isEditMode ? .primary : .soft
            ) {
                withAnimation { isEditMode.toggle() }
            }

            if isEditMode {
                CompactPillButton(title: "Add Day", systemImage: "plus", kind: .soft) {
                    addDay()
                }
                CompactPillButton(title: "Reset", systemImage: "arrow.counterclockwise", kind: .soft) {
                    showResetConfirm = true
                }
            }
        }
    }

    private var daysList: some View {
        List {
            ForEach(session.itinerary?.days ?? []) { day in
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
            .onMove(perform: isEditMode ? moveDays : nil)
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .environment(\.editMode, .constant(isEditMode ? EditMode.active : EditMode.inactive))
        .frame(minHeight: CGFloat((session.itinerary?.days.count ?? 1) * 120))
    }

    private func dayCard(_ day: DayPlan) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(spacing: 4) {
                Text("\(day.day)")
                    .font(.title2.weight(.bold))
                    .foregroundStyle(ShellChrome.accent)
                Text("DAY")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(ShellChrome.inkMuted)
            }
            .frame(width: 44)

            VStack(alignment: .leading, spacing: 6) {
                Text(day.title)
                    .font(.headline)
                    .foregroundStyle(ShellChrome.ink)
                HStack(spacing: 12) {
                    Label(day.city, systemImage: "mappin.and.ellipse")
                    Label(day.date, systemImage: "calendar")
                }
                .font(.caption)
                .foregroundStyle(ShellChrome.inkMuted)
                Text("\(day.activities.count) activities")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ShellChrome.accent)
            }
            Spacer()
            if !isEditMode {
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(ShellChrome.inkMuted)
            }
        }
        .padding(18)
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
