export interface CurrencyMeta {
  code: string;
  name: string;
  symbol: string;
}

/** Currencies the wallet can display. Matches the destination catalog plus majors. */
export const CURRENCIES: CurrencyMeta[] = [
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KRW', name: 'Korean Won', symbol: '₩' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'TWD', name: 'Taiwan Dollar', symbol: 'NT$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'MVR', name: 'Maldivian Rufiyaa', symbol: 'Rf' },
  { code: 'KHR', name: 'Cambodian Riel', symbol: '៛' },
  { code: 'LAK', name: 'Lao Kip', symbol: '₭' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'ISK', name: 'Icelandic Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'CZK', name: 'Czech Koruna', symbol: 'Kč' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'HUF', name: 'Hungarian Forint', symbol: 'Ft' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QR' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SR' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JD' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'DH' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'ARS', name: 'Argentine Peso', symbol: 'AR$' },
  { code: 'PEN', name: 'Peruvian Sol', symbol: 'S/' },
  { code: 'CLP', name: 'Chilean Peso', symbol: 'CLP$' },
];

const BY_CODE = new Map(CURRENCIES.map((currency) => [currency.code, currency]));

export const currencyMeta = (code: string): CurrencyMeta =>
  BY_CODE.get(code.toUpperCase()) || { code: code.toUpperCase(), name: code.toUpperCase(), symbol: code.toUpperCase() };

export const currencySymbol = (code: string) => currencyMeta(code).symbol;

export const isSupportedCurrency = (code: string) => BY_CODE.has(code.toUpperCase());

/** Currencies without minor units — formatting should not show decimals. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'HUF', 'LAK', 'KHR']);

export const currencyDecimals = (code: string) => (ZERO_DECIMAL.has(code.toUpperCase()) ? 0 : 2);
