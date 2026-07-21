import SwiftUI

private enum BudgetSegment: String, CaseIterable, Identifiable {
    case budget = "Budget"
    case expenses = "Expenses"
    var id: String { rawValue }
}

struct BudgetView: View {
    @ObservedObject var session: TripSession
    @EnvironmentObject private var currency: CurrencyManager
    @EnvironmentObject private var auth: AuthViewModel

    @State private var budget = BudgetData.empty
    @State private var segment: BudgetSegment = .budget
    @State private var isEditing = false
    @State private var addItemCategory: BudgetCategory?
    @State private var draftItemLabel = ""
    @State private var draftItemCost = ""
    @State private var showAddExpense = false
    @State private var expenseDraft = ExpenseDraft()
    @State private var didLoad = false

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            header
            segmentControl
            currencyBar

            if segment == .budget {
                budgetPlanSection
            } else {
                expensesSection
            }
        }
        .padding(20)
        .onAppear { loadBudgetIfNeeded() }
        .onChange(of: budget) { _, _ in persistBudget() }
        .onChange(of: session.activeItineraryId) { _, _ in loadBudgetIfNeeded(force: true) }
        .sheet(item: $addItemCategory) { category in
            addItemSheet(category: category)
        }
        .sheet(isPresented: $showAddExpense) {
            addExpenseSheet
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(eyebrow: "The wallet", title: "Where the money goes")
            Text(segment == .budget
                 ? "Plan your trip budget by category."
                 : "Track what you actually spend and settle up.")
            .font(.subheadline)
            .foregroundStyle(ShellChrome.inkMuted)
        }
    }

    private var segmentControl: some View {
        HStack(spacing: 0) {
            ForEach(BudgetSegment.allCases) { tab in
                Button {
                    segment = tab
                } label: {
                    Text(tab.rawValue)
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .foregroundStyle(segment == tab ? ShellChrome.accent : ShellChrome.inkMuted)
                        .background(segment == tab ? ShellChrome.accentSoft : Color.clear)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(ShellChrome.cardBackground)
        .clipShape(Capsule())
        .overlay(Capsule().stroke(ShellChrome.border, lineWidth: 1))
    }

    private var currencyBar: some View {
        HStack(spacing: 12) {
            BudgetCurrencySelector(userId: auth.user?.id)
            Spacer()
            if segment == .budget {
                CompactPillButton(
                    title: isEditing ? "Done" : "Edit",
                    systemImage: isEditing ? "checkmark" : "pencil",
                    kind: isEditing ? .primary : .soft
                ) {
                    isEditing.toggle()
                }
            }
        }
    }

    private var budgetPlanSection: some View {
        VStack(spacing: 16) {
            totalEstimateCard
            ForEach(BudgetCategory.allCases) { category in
                categoryCard(category)
            }
        }
    }

    private var totalEstimateCard: some View {
        let ranges = BudgetCategory.allCases.map { BudgetLogic.categoryRange(budget[$0]) }
        let minTotal = ranges.map(\.min).reduce(0, +)
        let maxTotal = ranges.map(\.max).reduce(0, +)
        return VStack(spacing: 8) {
            Text("TOTAL ESTIMATE")
                .font(.caption.weight(.semibold))
                .tracking(1.1)
                .foregroundStyle(ShellChrome.inkMuted)
            Text("\(currency.format(currency.convert(minTotal))) – \(currency.format(currency.convert(maxTotal)))")
                .font(.title2.weight(.bold))
                .foregroundStyle(ShellChrome.ink)
            if let days = session.itinerary?.days.count, days > 0 {
                Text("\(days) day\(days == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(20)
        .shellCard()
    }

    private func categoryCard(_ category: BudgetCategory) -> some View {
        let data = budget[category]
        let range = BudgetLogic.categoryRange(data)
        let itemsTotal = BudgetLogic.itemsTotal(data.items)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: BudgetLogic.icon(for: category))
                    .foregroundStyle(ShellChrome.accent)
                Text(BudgetLogic.title(for: category))
                    .font(.headline)
                Spacer()
                Text("\(currency.format(currency.convert(range.min))) – \(currency.format(currency.convert(range.max)))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ShellChrome.inkMuted)
            }

            if isEditing {
                HStack(spacing: 10) {
                    rangeField(title: "Min", value: range.min, category: category, field: .min)
                    rangeField(title: "Max", value: range.max, category: category, field: .max)
                }
                CompactPillButton(title: "Add item", systemImage: "plus", kind: .soft) {
                    addItemCategory = category
                }
            }

            if !data.items.isEmpty {
                VStack(spacing: 8) {
                    ForEach(data.items) { item in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                if isEditing {
                                    TextField("Label", text: bindingItemLabel(category: category, id: item.id))
                                        .textFieldStyle(.roundedBorder)
                                    TextField("Cost (MYR)", text: bindingItemCost(category: category, id: item.id))
                                        .textFieldStyle(.roundedBorder)
                                        .keyboardType(.decimalPad)
                                } else {
                                    Text(item.label)
                                        .font(.subheadline.weight(.medium))
                                    Text(BudgetLogic.displayCost(item.cost, currency: currency))
                                        .font(.caption)
                                        .foregroundStyle(ShellChrome.inkMuted)
                                }
                            }
                            Spacer()
                            if isEditing {
                                Button(role: .destructive) {
                                    deleteItem(category: category, id: item.id)
                                } label: {
                                    Image(systemName: "trash")
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(10)
                        .background(ShellChrome.background)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                }
            } else if !isEditing {
                Text("No line items yet.")
                    .font(.caption)
                    .foregroundStyle(ShellChrome.inkMuted)
            }

            if itemsTotal > 0, !isEditing {
                Text("Items total: \(currency.format(currency.convert(itemsTotal)))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ShellChrome.accent)
            }
        }
        .padding(16)
        .shellCard()
    }

    private enum RangeField { case min, max }

    private func rangeField(title: String, value: Double, category: BudgetCategory, field: RangeField) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ShellChrome.inkMuted)
            TextField("0", value: bindingRange(category: category, field: field), format: .number)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.decimalPad)
        }
    }

    private var expensesSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Actual expenses")
                        .font(.headline)
                    Text("Stored in MYR · shown in \(currency.currency)")
                        .font(.caption)
                        .foregroundStyle(ShellChrome.inkMuted)
                }
                Spacer()
                CompactPillButton(title: "Add", systemImage: "plus", kind: .primary) {
                    expenseDraft = ExpenseDraft()
                    showAddExpense = true
                }
            }

            expenseSummaryCard

            if budget.expenses.isEmpty {
                EmptyState(
                    systemImage: "receipt",
                    title: "No expenses yet",
                    message: "Add your first expense to track spending."
                )
                .padding(.vertical, 12)
            } else {
                ForEach(sortedExpenses) { expense in
                    expenseRow(expense)
                }
            }
        }
    }

    private var expenseSummaryCard: some View {
        let total = budget.expenses.map(\.amount).reduce(0, +)
        let t1 = budget.expenses.filter { $0.paidBy == .traveler1 }.map(\.amount).reduce(0, +)
        let t2 = budget.expenses.filter { $0.paidBy == .traveler2 }.map(\.amount).reduce(0, +)
        let settlement = BudgetLogic.settleUp(total: total, traveler1Paid: t1, traveler2Paid: t2)

        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Total spent")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ShellChrome.inkMuted)
                Spacer()
                Text(currency.format(currency.convert(total)))
                    .font(.title3.weight(.bold))
            }
            Divider()
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(ExpensePaidBy.traveler1.rawValue)
                        .font(.caption.weight(.semibold))
                    Text(currency.format(currency.convert(t1)))
                        .font(.subheadline.weight(.medium))
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    Text(ExpensePaidBy.traveler2.rawValue)
                        .font(.caption.weight(.semibold))
                    Text(currency.format(currency.convert(t2)))
                        .font(.subheadline.weight(.medium))
                }
            }
            if let settlement {
                Text(settlement)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ShellChrome.accent)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 4)
            }
        }
        .padding(16)
        .shellCard()
    }

    private func expenseRow(_ expense: Expense) -> some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(expense.description)
                    .font(.subheadline.weight(.semibold))
                HStack(spacing: 8) {
                    Text(expense.date)
                    Text("·")
                    Text(expense.paidBy.rawValue)
                    Text("·")
                    Text(BudgetLogic.titleForExpenseCategory(expense.category))
                }
                .font(.caption)
                .foregroundStyle(ShellChrome.inkMuted)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 8) {
                Text(currency.format(currency.convert(expense.amount)))
                    .font(.subheadline.weight(.bold))
                Button(role: .destructive) {
                    deleteExpense(expense.id)
                } label: {
                    Image(systemName: "trash")
                        .font(.caption)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(14)
        .shellCard()
    }

    private func addItemSheet(category: BudgetCategory) -> some View {
        NavigationStack {
            Form {
                Section("Item") {
                    TextField("Label", text: $draftItemLabel)
                    TextField("Cost (MYR)", text: $draftItemCost)
                        .keyboardType(.decimalPad)
                }
            }
            .navigationTitle(BudgetLogic.title(for: category))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        addItemCategory = nil
                        draftItemLabel = ""
                        draftItemCost = ""
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        confirmAddItem(category: category)
                    }
                    .disabled(draftItemLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }

    private var addExpenseSheet: some View {
        NavigationStack {
            Form {
                Section("Expense") {
                    TextField("Description", text: $expenseDraft.description)
                    TextField("Amount", value: $expenseDraft.displayAmount, format: .number)
                        .keyboardType(.decimalPad)
                    Picker("Paid by", selection: $expenseDraft.paidBy) {
                        Text(ExpensePaidBy.traveler1.rawValue).tag(ExpensePaidBy.traveler1)
                        Text(ExpensePaidBy.traveler2.rawValue).tag(ExpensePaidBy.traveler2)
                    }
                    Picker("Category", selection: $expenseDraft.category) {
                        ForEach(BudgetCategory.allCases) { cat in
                            Text(BudgetLogic.title(for: cat)).tag(cat.rawValue)
                        }
                        Text("General").tag("general")
                    }
                    DatePicker("Date", selection: $expenseDraft.date, displayedComponents: .date)
                }
            }
            .navigationTitle("New expense")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showAddExpense = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { saveExpense() }
                        .disabled(expenseDraft.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || expenseDraft.displayAmount <= 0)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var sortedExpenses: [Expense] {
        budget.expenses.sorted { $0.date > $1.date }
    }

    // MARK: - Actions

    private func loadBudgetIfNeeded(force: Bool = false) {
        guard let tripId = session.activeItineraryId else { return }
        if didLoad, !force { return }
        if let stored = LocalStore.loadBudget(tripId: tripId) {
            budget = stored
        } else if let itinerary = session.itinerary {
            budget = BudgetLogic.seedFromItinerary(itinerary, currency: currency)
            LocalStore.saveBudget(budget, tripId: tripId)
        } else {
            budget = .empty
        }
        didLoad = true
        if let userId = auth.user?.id {
            currency.loadCurrencyForUser(userId)
        }
    }

    private func persistBudget() {
        guard let tripId = session.activeItineraryId, didLoad else { return }
        LocalStore.saveBudget(budget, tripId: tripId)
    }

    private func confirmAddItem(category: BudgetCategory) {
        let label = draftItemLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return }
        let costString = draftItemCost.trimmingCharacters(in: .whitespacesAndNewlines)
        let cost = costString.isEmpty ? "RM 0" : (costString.lowercased().contains("rm") ? costString : "RM \(costString)")
        var data = budget[category]
        data.items.append(BudgetItem(id: UUID().uuidString, label: label, cost: cost))
        budget[category] = data
        addItemCategory = nil
        draftItemLabel = ""
        draftItemCost = ""
    }

    private func deleteItem(category: BudgetCategory, id: String) {
        var data = budget[category]
        data.items.removeAll { $0.id == id }
        budget[category] = data
    }

    private func bindingItemLabel(category: BudgetCategory, id: String) -> Binding<String> {
        Binding(
            get: { budget[category].items.first(where: { $0.id == id })?.label ?? "" },
            set: { newValue in
                var data = budget[category]
                guard let index = data.items.firstIndex(where: { $0.id == id }) else { return }
                data.items[index].label = newValue
                budget[category] = data
            }
        )
    }

    private func bindingItemCost(category: BudgetCategory, id: String) -> Binding<String> {
        Binding(
            get: { budget[category].items.first(where: { $0.id == id })?.cost ?? "" },
            set: { newValue in
                var data = budget[category]
                guard let index = data.items.firstIndex(where: { $0.id == id }) else { return }
                data.items[index].cost = newValue
                budget[category] = data
            }
        )
    }

    private func bindingRange(category: BudgetCategory, field: RangeField) -> Binding<Double> {
        Binding(
            get: {
                switch field {
                case .min: return budget[category].min
                case .max: return budget[category].max
                }
            },
            set: { newValue in
                var data = budget[category]
                switch field {
                case .min: data.min = newValue
                case .max: data.max = newValue
                }
                budget[category] = data
            }
        )
    }

    private func saveExpense() {
        let description = expenseDraft.description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !description.isEmpty else { return }
        let amountMYR = currency.toBase(expenseDraft.displayAmount)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        let expense = Expense(
            id: UUID().uuidString,
            description: description,
            amount: amountMYR,
            paidBy: expenseDraft.paidBy,
            category: expenseDraft.category,
            date: formatter.string(from: expenseDraft.date)
        )
        budget.expenses.append(expense)
        showAddExpense = false
    }

    private func deleteExpense(_ id: String) {
        budget.expenses.removeAll { $0.id == id }
    }
}

// MARK: - Currency selector

private struct BudgetCurrencySelector: View {
    @EnvironmentObject private var currency: CurrencyManager
    let userId: String?

    var body: some View {
        HStack(spacing: 8) {
            Menu {
                ForEach(CurrencyManager.supportedCurrencies) { item in
                    Button {
                        currency.setCurrency(item.code, userId: userId)
                    } label: {
                        if currency.currency == item.code {
                            Label("\(item.code) · \(item.name)", systemImage: "checkmark")
                        } else {
                            Text("\(item.code) · \(item.name)")
                        }
                    }
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "coloncurrencysign.circle")
                    Text(currency.currency)
                        .font(.caption.weight(.bold))
                }
                .padding(.vertical, 8)
                .padding(.horizontal, 12)
                .foregroundStyle(ShellChrome.ink)
                .background(ShellChrome.accentSoft)
                .clipShape(Capsule())
            }

            Button {
                Task { await currency.refreshRates(force: true) }
            } label: {
                Image(systemName: currency.rates.isLoading ? "arrow.triangle.2.circlepath" : "arrow.clockwise")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(ShellChrome.accent)
                    .padding(8)
                    .background(ShellChrome.cardBackground)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(ShellChrome.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .disabled(currency.rates.isLoading)
        }
    }
}

// MARK: - Draft & logic

private struct ExpenseDraft {
    var description = ""
    var displayAmount: Double = 0
    var paidBy: ExpensePaidBy = .traveler1
    var category: String = BudgetCategory.food.rawValue
    var date = Date()
}

private enum BudgetLogic {
    static func title(for category: BudgetCategory) -> String {
        switch category {
        case .flights: return "Flights"
        case .accommodation: return "Accommodation"
        case .transportation: return "Transportation"
        case .food: return "Food & Dining"
        case .activities: return "Activities"
        case .misc: return "Misc & Shopping"
        }
    }

    static func titleForExpenseCategory(_ raw: String) -> String {
        if let cat = BudgetCategory(rawValue: raw) { return title(for: cat) }
        return raw.capitalized
    }

    static func icon(for category: BudgetCategory) -> String {
        switch category {
        case .flights: return "airplane"
        case .accommodation: return "bed.double"
        case .transportation: return "tram"
        case .food: return "fork.knife"
        case .activities: return "ticket"
        case .misc: return "bag"
        }
    }

    static func parseBudgetItemCost(_ value: String) -> Double {
        let normalized = value.replacingOccurrences(of: ",", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty { return 0 }
        if normalized.range(of: #"^[0-9]+(\.[0-9]+)?$"#, options: .regularExpression) != nil {
            return Double(normalized) ?? 0
        }
        guard normalized.range(of: "rm", options: .caseInsensitive) != nil else { return 0 }
        guard let match = normalized.range(of: #"(\d+(\.\d+)?)"#, options: .regularExpression) else { return 0 }
        return Double(normalized[match]) ?? 0
    }

    static func numbersInCost(_ cost: String) -> [Double] {
        guard let regex = try? NSRegularExpression(pattern: #"(\d+(?:\.\d+)?)"#) else { return [] }
        let range = NSRange(cost.startIndex..., in: cost)
        return regex.matches(in: cost, range: range).compactMap { result in
            guard let swiftRange = Range(result.range(at: 1), in: cost) else { return nil }
            return Double(cost[swiftRange])
        }
    }

    static func itemsTotal(_ items: [BudgetItem]) -> Double {
        items.reduce(0) { $0 + parseBudgetItemCost($1.cost) }
    }

    static func categoryRange(_ data: BudgetCategoryData) -> (min: Double, max: Double) {
        let itemsTotal = itemsTotal(data.items)
        let maxVal = max(data.max, itemsTotal)
        let minVal = min(data.min, maxVal)
        return (minVal, maxVal)
    }

    static func displayCost(_ cost: String, currency: CurrencyManager) -> String {
        let myr = parseBudgetItemCost(cost)
        return currency.format(currency.convert(myr))
    }

    static func seedFromItinerary(_ itinerary: Itinerary, currency: CurrencyManager) -> BudgetData {
        var transportMYR = 0.0
        var foodMYR = 0.0
        var activitiesMYR = 0.0
        var transportItems: [BudgetItem] = []
        var foodItems: [BudgetItem] = []
        var activityItems: [BudgetItem] = []

        for day in itinerary.days {
            for (index, activity) in day.activities.enumerated() {
                guard let costText = activity.cost, !costText.isEmpty else { continue }
                let numbers = numbersInCost(costText)
                guard !numbers.isEmpty else { continue }
                let avgCNY = numbers.reduce(0, +) / Double(numbers.count)
                let costInMYR = currency.toBase(avgCNY, from: "CNY")
                let item = BudgetItem(id: "auto-\(day.day)-\(index)", label: activity.name, cost: costText)
                switch activity.type {
                case .travel, .flight:
                    transportMYR += costInMYR
                    transportItems.append(item)
                case .food, .cafe:
                    foodMYR += costInMYR
                    foodItems.append(item)
                case .sight, .culture, .nature, .walk, .shop, .nightlife:
                    activitiesMYR += costInMYR
                    activityItems.append(item)
                default:
                    break
                }
            }
        }

        let empty = BudgetCategoryData(min: 0, max: 0, items: [])
        return BudgetData(
            flights: empty,
            accommodation: empty,
            transportation: BudgetCategoryData(min: ceil(transportMYR), max: ceil(transportMYR), items: transportItems),
            food: BudgetCategoryData(min: ceil(foodMYR), max: ceil(foodMYR), items: foodItems),
            activities: BudgetCategoryData(min: ceil(activitiesMYR), max: ceil(activitiesMYR), items: activityItems),
            misc: empty,
            expenses: []
        )
    }

    static func settleUp(total: Double, traveler1Paid: Double, traveler2Paid: Double) -> String? {
        guard total > 0 else { return nil }
        let half = total / 2
        let diff = traveler1Paid - half
        if abs(diff) < 0.01 { return "You're all settled up." }
        let amount = abs(diff)
        let formatted = CurrencyManager.formatCurrency(amount, currency: "MYR")
        if diff > 0 {
            return "\(ExpensePaidBy.traveler2.rawValue) owes \(ExpensePaidBy.traveler1.rawValue) \(formatted)"
        }
        return "\(ExpensePaidBy.traveler1.rawValue) owes \(ExpensePaidBy.traveler2.rawValue) \(formatted)"
    }
}
