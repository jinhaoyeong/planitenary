import SwiftUI

private enum ChecklistFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case packing = "Packing"
    case pretrip = "Pre-trip"
    case daily = "Daily"

    var id: String { rawValue }

    var category: ChecklistCategory? {
        switch self {
        case .all: return nil
        case .packing: return .packing
        case .pretrip: return .pretrip
        case .daily: return .daily
        }
    }
}

struct ChecklistView: View {
    @ObservedObject var session: TripSession
    @EnvironmentObject private var auth: AuthViewModel

    @State private var items: [ChecklistItem] = []
    @State private var filter: ChecklistFilter = .all
    @State private var newItemText = ""
    @State private var newItemCategory: ChecklistCategory = .packing
    @State private var editingItemId: String?
    @State private var editingText = ""
    @State private var editingCategory: ChecklistCategory = .packing
    @State private var showResetConfirm = false
    @State private var didLoad = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            filterBar
            progressBar
            addRow
            itemList
            resetButton
        }
        .padding(20)
        .onAppear { loadChecklist(force: false) }
        .onChange(of: items) { _, _ in persistChecklist() }
        .onChange(of: auth.user?.id) { _, _ in loadChecklist(force: true) }
        .alert("Reset progress?", isPresented: $showResetConfirm) {
            Button("Cancel", role: .cancel) {}
            Button("Reset", role: .destructive) { resetProgress() }
        } message: {
            Text("Uncheck every item. Your list text stays the same.")
        }
    }

    private var header: some View {
        EditorialPageHeader(
            eyebrow: "The checklist · small things to remember",
            titleLeading: "Bits to",
            titleAccent: "pack.",
            subtitle: "Pre-trip chores, daily reminders, and everything that needs to fit in the suitcase.",
            centered: true,
            titleSize: 42
        )
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(ChecklistFilter.allCases) { option in
                    CompactPillButton(
                        title: option.rawValue,
                        systemImage: icon(for: option),
                        kind: filter == option ? .primary : .soft
                    ) {
                        filter = option
                    }
                }
            }
        }
    }

    private var progressBar: some View {
        let completed = items.filter(\.completed).count
        let total = max(items.count, 1)
        let percent = Int((Double(completed) / Double(total)) * 100)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("\(completed) of \(items.count) done")
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("\(percent)%")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(ShellChrome.accent)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(ShellChrome.border)
                    Capsule()
                        .fill(ShellChrome.accent)
                        .frame(width: geo.size.width * CGFloat(completed) / CGFloat(total))
                }
            }
            .frame(height: 8)
        }
        .padding(16)
        .shellCard()
    }

    private var addRow: some View {
        VStack(spacing: 10) {
            TextField("Add new checklist item…", text: $newItemText)
                .textFieldStyle(.roundedBorder)
            HStack {
                Picker("Category", selection: $newItemCategory) {
                    ForEach(ChecklistCategory.allCases) { cat in
                        Text(cat.rawValue).tag(cat)
                    }
                }
                .pickerStyle(.menu)
                Spacer()
                CompactPillButton(title: "Add", systemImage: "plus", kind: .primary) {
                    addItem()
                }
                .disabled(newItemText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(16)
        .shellCard()
    }

    private var itemList: some View {
        VStack(spacing: 10) {
            if filteredItems.isEmpty {
                EmptyState(
                    systemImage: "checkmark.square",
                    title: "Nothing here yet",
                    message: filter == .all ? "Add your first checklist item above." : "No items in this category."
                )
                .padding(.vertical, 8)
            } else {
                ForEach(filteredItems) { item in
                    itemRow(item)
                }
            }
        }
    }

    private func itemRow(_ item: ChecklistItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                Button {
                    toggleItem(item.id)
                } label: {
                    Image(systemName: item.completed ? "checkmark.square.fill" : "square")
                        .font(.title3)
                        .foregroundStyle(item.completed ? ShellChrome.accent : ShellChrome.inkMuted)
                }
                .buttonStyle(.plain)

                if editingItemId == item.id {
                    VStack(alignment: .leading, spacing: 8) {
                        TextField("Item text", text: $editingText)
                            .textFieldStyle(.roundedBorder)
                        Picker("Category", selection: $editingCategory) {
                            ForEach(ChecklistCategory.allCases) { cat in
                                Text(cat.rawValue).tag(cat)
                            }
                        }
                        .pickerStyle(.menu)
                        HStack {
                            CompactPillButton(title: "Save", systemImage: "checkmark", kind: .primary) {
                                saveEdit(item.id)
                            }
                            CompactPillButton(title: "Cancel", kind: .ghost) {
                                cancelEdit()
                            }
                        }
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(item.text)
                            .font(.subheadline.weight(.semibold))
                            .strikethrough(item.completed)
                            .foregroundStyle(item.completed ? ShellChrome.inkMuted : ShellChrome.ink)
                        Text(item.category.rawValue)
                            .font(.caption2.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(categoryTint(item.category))
                            .clipShape(Capsule())
                    }
                }

                Spacer()

                if editingItemId != item.id {
                    HStack(spacing: 4) {
                        Button {
                            startEdit(item)
                        } label: {
                            Image(systemName: "pencil")
                                .foregroundStyle(ShellChrome.inkMuted)
                        }
                        .buttonStyle(.plain)
                        Button(role: .destructive) {
                            deleteItem(item.id)
                        } label: {
                            Image(systemName: "trash")
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .padding(14)
        .shellCard()
    }

    private var resetButton: some View {
        PillButton(title: "Reset progress", systemImage: "arrow.counterclockwise", kind: .ghost) {
            showResetConfirm = true
        }
    }

    private var filteredItems: [ChecklistItem] {
        guard let category = filter.category else { return items }
        return items.filter { $0.category == category }
    }

    private func icon(for filter: ChecklistFilter) -> String? {
        switch filter {
        case .all: return "square.stack.3d.up"
        case .packing: return "shippingbox"
        case .pretrip: return "list.clipboard"
        case .daily: return "calendar"
        }
    }

    private func categoryTint(_ category: ChecklistCategory) -> Color {
        switch category {
        case .packing: return Color.blue.opacity(0.12)
        case .pretrip: return Color.orange.opacity(0.12)
        case .daily: return Color.green.opacity(0.12)
        }
    }

    private func loadChecklist(force: Bool) {
        if didLoad, !force { return }
        let loaded = LocalStore.loadChecklist(userId: auth.user?.id)
        if loaded.isEmpty {
            items = ChecklistDefaults.seedItems()
            persistChecklist()
        } else {
            items = loaded
        }
        didLoad = true
    }

    private func persistChecklist() {
        guard didLoad else { return }
        LocalStore.saveChecklist(items, userId: auth.user?.id)
    }

    private func toggleItem(_ id: String) {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].completed.toggle()
    }

    private func addItem() {
        let text = newItemText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let item = ChecklistItem(
            id: UUID().uuidString,
            text: text,
            category: newItemCategory,
            completed: false,
            isCustom: true
        )
        items.insert(item, at: 0)
        newItemText = ""
    }

    private func startEdit(_ item: ChecklistItem) {
        editingItemId = item.id
        editingText = item.text
        editingCategory = item.category
    }

    private func saveEdit(_ id: String) {
        let text = editingText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard let index = items.firstIndex(where: { $0.id == id }) else { return }
        items[index].text = text
        items[index].category = editingCategory
        cancelEdit()
    }

    private func cancelEdit() {
        editingItemId = nil
        editingText = ""
    }

    private func deleteItem(_ id: String) {
        items.removeAll { $0.id == id }
        if editingItemId == id { cancelEdit() }
    }

    private func resetProgress() {
        items = items.map { ChecklistItem(id: $0.id, text: $0.text, category: $0.category, completed: false, isCustom: $0.isCustom) }
    }
}

private enum ChecklistDefaults {
    static func seedItems() -> [ChecklistItem] {
        let packing = [
            "Passport / ID",
            "Phone charger & adapter",
            "Comfortable walking shoes",
            "Toiletries kit",
            "Weather-appropriate clothes",
        ].map { make($0, .packing) }

        let pretrip = [
            "Confirm hotel bookings",
            "Download offline maps",
            "Notify bank of travel",
            "Check travel insurance",
            "Share itinerary with partner",
        ].map { make($0, .pretrip) }

        let daily = [
            "Check weather for the day",
            "Charge devices overnight",
            "Review today's plan",
            "Keep essentials in day bag",
        ].map { make($0, .daily) }

        return packing + pretrip + daily
    }

    private static func make(_ text: String, _ category: ChecklistCategory) -> ChecklistItem {
        ChecklistItem(id: UUID().uuidString, text: text, category: category, completed: false, isCustom: false)
    }
}
