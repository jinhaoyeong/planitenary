import Foundation
import Combine

struct SupportedCurrency: Identifiable, Hashable {
    let code: String
    let name: String
    let symbol: String
    var id: String { code }
}

struct ExchangeRates: Equatable {
    var values: [String: Double]
    var lastUpdated: TimeInterval
    var fetchedAt: TimeInterval
    var isLoading: Bool
    var isFallback: Bool

    static func initialFallback() -> ExchangeRates {
        ExchangeRates(
            values: CurrencyService.fallbackValues,
            lastUpdated: 0,
            fetchedAt: 0,
            isLoading: true,
            isFallback: true
        )
    }
}

@MainActor
final class CurrencyManager: ObservableObject {
    static let shared = CurrencyManager()

    static let supportedCurrencies: [SupportedCurrency] = [
        SupportedCurrency(code: "MYR", name: "Malaysian Ringgit", symbol: "RM"),
        SupportedCurrency(code: "CNY", name: "Chinese Yuan", symbol: "¥"),
        SupportedCurrency(code: "USD", name: "US Dollar", symbol: "$"),
        SupportedCurrency(code: "EUR", name: "Euro", symbol: "€"),
        SupportedCurrency(code: "GBP", name: "British Pound", symbol: "£"),
        SupportedCurrency(code: "SGD", name: "Singapore Dollar", symbol: "S$"),
        SupportedCurrency(code: "JPY", name: "Japanese Yen", symbol: "¥"),
        SupportedCurrency(code: "KRW", name: "South Korean Won", symbol: "₩"),
        SupportedCurrency(code: "THB", name: "Thai Baht", symbol: "฿"),
        SupportedCurrency(code: "IDR", name: "Indonesian Rupiah", symbol: "Rp"),
        SupportedCurrency(code: "AUD", name: "Australian Dollar", symbol: "A$"),
        SupportedCurrency(code: "CAD", name: "Canadian Dollar", symbol: "C$"),
    ]

    static let fallbackValues: [String: Double] = [
        "MYR": 1, "CNY": 1.66, "USD": 0.23, "EUR": 0.20, "GBP": 0.17, "SGD": 0.29,
        "JPY": 35.5, "KRW": 334, "THB": 7.3, "IDR": 3800, "AUD": 0.33, "CAD": 0.31,
    ]

    private static let exchangeAPIURL = URL(string: "https://open.er-api.com/v6/latest/MYR")!
    private static let cacheKey = LocalStore.exchangeRatesKey
    private static let selectedCurrencyKey = LocalStore.selectedCurrencyKey
    private static let cacheDuration: TimeInterval = 15 * 60

    @Published private(set) var rates = ExchangeRates.initialFallback()
    @Published var currency: String = "MYR"

    private var refreshTask: Task<Void, Never>?

    private init() {
        if let saved = UserDefaults.standard.string(forKey: Self.selectedCurrencyKey),
           Self.supportedCurrencies.contains(where: { $0.code == saved }) {
            currency = saved
        }
        if let cached = readCache(allowExpired: false) {
            rates = cached
        }
        refreshTask = Task { await startAutoRefresh() }
    }

    deinit {
        refreshTask?.cancel()
    }

    func refreshRates(force: Bool = false) async {
        if !force, let cached = readCache(allowExpired: false) {
            rates = cached
            return
        }

        rates.isLoading = true
        do {
            var request = URLRequest(url: Self.exchangeAPIURL)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            struct APIResponse: Decodable {
                let result: String?
                let rates: [String: Double]?
                let timeLastUpdateUnix: Int?
            }
            let payload = try JSONDecoder().decode(APIResponse.self, from: data)
            guard payload.result == "success", let apiRates = payload.rates else {
                throw URLError(.cannotParseResponse)
            }

            var values: [String: Double] = [:]
            for item in Self.supportedCurrencies {
                if item.code == "MYR" {
                    values[item.code] = 1
                } else if let value = apiRates[item.code], value > 0 {
                    values[item.code] = value
                } else {
                    throw URLError(.cannotParseResponse)
                }
            }

            let next = ExchangeRates(
                values: values,
                lastUpdated: payload.timeLastUpdateUnix.map { TimeInterval($0) * 1000 } ?? Date().timeIntervalSince1970 * 1000,
                fetchedAt: Date().timeIntervalSince1970 * 1000,
                isLoading: false,
                isFallback: false
            )
            rates = next
            persistCache(next)
        } catch {
            if let stale = readCache(allowExpired: true) {
                rates = ExchangeRates(
                    values: stale.values,
                    lastUpdated: stale.lastUpdated,
                    fetchedAt: stale.fetchedAt,
                    isLoading: false,
                    isFallback: true
                )
            } else {
                rates = ExchangeRates(
                    values: Self.fallbackValues,
                    lastUpdated: Date().timeIntervalSince1970 * 1000,
                    fetchedAt: Date().timeIntervalSince1970 * 1000,
                    isLoading: false,
                    isFallback: true
                )
            }
        }
    }

    func setCurrency(_ code: String, userId: String? = nil) {
        guard Self.supportedCurrencies.contains(where: { $0.code == code }) else { return }
        currency = code
        UserDefaults.standard.set(code, forKey: Self.selectedCurrencyKey)
        if let userId {
            LocalStore.saveSelectedCurrency(code, userId: userId)
        }
    }

    func loadCurrencyForUser(_ userId: String) {
        if let saved = LocalStore.loadSelectedCurrency(userId: userId),
           Self.supportedCurrencies.contains(where: { $0.code == saved }) {
            currency = saved
            UserDefaults.standard.set(saved, forKey: Self.selectedCurrencyKey)
        }
    }

    func format(_ amount: Double) -> String {
        Self.formatCurrency(amount, currency: currency)
    }

    func convert(_ amount: Double, from fromCurrency: String? = nil) -> Double {
        Self.convertCurrency(amount, from: fromCurrency ?? "MYR", to: currency, rates: rates)
    }

    func toBase(_ amount: Double, from fromCurrency: String? = nil) -> Double {
        Self.convertCurrency(amount, from: fromCurrency ?? currency, to: "MYR", rates: rates)
    }

    static func formatCurrency(_ amount: Double, currency: String) -> String {
        let fractionDigits: Int = ["JPY", "KRW", "IDR"].contains(currency) ? 0 : 2
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currency
        formatter.maximumFractionDigits = fractionDigits
        formatter.minimumFractionDigits = fractionDigits
        return formatter.string(from: NSNumber(value: amount)) ?? "\(amount)"
    }

    static func convertCurrency(_ amount: Double, from: String, to: String, rates: ExchangeRates) -> Double {
        if from == to { return amount }
        guard let fromRate = rates.values[from], let toRate = rates.values[to], fromRate > 0 else {
            return amount
        }
        return (amount / fromRate) * toRate
    }

    private func startAutoRefresh() async {
        await refreshRates()
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 15 * 60 * 1_000_000_000)
            await refreshRates(force: true)
        }
    }

    private func readCache(allowExpired: Bool) -> ExchangeRates? {
        guard let data = UserDefaults.standard.data(forKey: Self.cacheKey),
              let cached = try? JSONDecoder().decode(CachedRates.self, from: data)
        else { return nil }

        let complete = Self.supportedCurrencies.allSatisfy { cached.values[$0.code] != nil }
        guard complete else { return nil }
        let age = Date().timeIntervalSince1970 * 1000 - cached.fetchedAt
        if !allowExpired, age >= Self.cacheDuration * 1000 { return nil }
        return ExchangeRates(
            values: cached.values,
            lastUpdated: cached.lastUpdated,
            fetchedAt: cached.fetchedAt,
            isLoading: false,
            isFallback: cached.isFallback
        )
    }

    private func persistCache(_ rates: ExchangeRates) {
        let payload = CachedRates(
            values: rates.values,
            lastUpdated: rates.lastUpdated,
            fetchedAt: rates.fetchedAt,
            isFallback: rates.isFallback
        )
        if let data = try? JSONEncoder().encode(payload) {
            UserDefaults.standard.set(data, forKey: Self.cacheKey)
        }
    }

    private struct CachedRates: Codable {
        let values: [String: Double]
        let lastUpdated: TimeInterval
        let fetchedAt: TimeInterval
        let isFallback: Bool
    }
}

typealias CurrencyService = CurrencyManager
