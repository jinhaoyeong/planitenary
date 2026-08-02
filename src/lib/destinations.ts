/**
 * Destination intelligence: country → currency, map center, and the visual
 * identity seed (accent palette + motifs) used to theme a travel handbook.
 */

export interface DestinationPalette {
  accent: string;
  accentSoft: string;
  darkAccent: string;
  darkAccentSoft: string;
}

export interface CountryProfile {
  name: string;
  /** ISO 3166-1 alpha-2, used for flags and lookups. */
  code: string;
  /** ISO 4217 currency for the destination. */
  currency: string;
  /** Rough country centroid, used before cities are geocoded. */
  center: [number, number];
  /** Words the copy generator can weave into taglines. */
  motifs: string[];
  palette: DestinationPalette;
  aliases?: string[];
}

const PALETTES: Record<string, DestinationPalette> = {
  sakura: { accent: '#E4557B', accentSoft: '#FFE1E8', darkAccent: '#FF7C9E', darkAccentSoft: '#3B1F28' },
  crimson: { accent: '#D8443C', accentSoft: '#FFE0DB', darkAccent: '#FF7A6B', darkAccentSoft: '#3A1E1A' },
  jade: { accent: '#1F9C74', accentSoft: '#D8F3E8', darkAccent: '#4ED2A0', darkAccentSoft: '#12302A' },
  alpine: { accent: '#2F6FBF', accentSoft: '#DCE9FB', darkAccent: '#6FA9F0', darkAccentSoft: '#16263B' },
  terracotta: { accent: '#D2703A', accentSoft: '#FCE6D6', darkAccent: '#F09963', darkAccentSoft: '#3A241A' },
  gold: { accent: '#B98A2E', accentSoft: '#FAEED0', darkAccent: '#E4B857', darkAccentSoft: '#332818' },
  midnight: { accent: '#5A5FCF', accentSoft: '#E2E3FB', darkAccent: '#8B90F2', darkAccentSoft: '#22233F' },
  lagoon: { accent: '#0F92A8', accentSoft: '#D4F0F5', darkAccent: '#4FC9DC', darkAccentSoft: '#0F2C33' },
  saffron: { accent: '#E0872B', accentSoft: '#FCEBD3', darkAccent: '#F5AC5C', darkAccentSoft: '#38270F' },
  olive: { accent: '#7A8B3A', accentSoft: '#EDF2D9', darkAccent: '#AFC168', darkAccentSoft: '#252B15' },
  rose: { accent: '#EE4D87', accentSoft: '#FFE4EE', darkAccent: '#FF6B9A', darkAccentSoft: '#3A1F2A' },
  aurora: { accent: '#3E8E9B', accentSoft: '#DAF0F2', darkAccent: '#69C3CF', darkAccentSoft: '#152C30' },
  desert: { accent: '#C0844C', accentSoft: '#F8EADA', darkAccent: '#E0A870', darkAccentSoft: '#332618' },
  forest: { accent: '#3C7D4F', accentSoft: '#DCEFE0', darkAccent: '#6FBF87', darkAccentSoft: '#152A1C' },
};

const COUNTRIES: CountryProfile[] = [
  { name: 'Japan', code: 'JP', currency: 'JPY', center: [36.2048, 138.2529], motifs: ['temple lanes', 'ramen counters', 'cherry blossom', 'quiet shrines'], palette: PALETTES.sakura },
  { name: 'South Korea', code: 'KR', currency: 'KRW', center: [36.5, 127.85], motifs: ['palace walls', 'street food alleys', 'mountain trails', 'late-night cafés'], palette: PALETTES.midnight, aliases: ['korea'] },
  { name: 'China', code: 'CN', currency: 'CNY', center: [35.8617, 104.1954], motifs: ['old town lanes', 'tea houses', 'night markets', 'misty peaks'], palette: PALETTES.crimson },
  { name: 'Taiwan', code: 'TW', currency: 'TWD', center: [23.6978, 120.9605], motifs: ['night markets', 'mountain railways', 'tea terraces', 'harbour towns'], palette: PALETTES.jade },
  { name: 'Hong Kong', code: 'HK', currency: 'HKD', center: [22.3193, 114.1694], motifs: ['harbour lights', 'dim sum tables', 'skyline trails', 'tram rides'], palette: PALETTES.crimson },
  { name: 'Thailand', code: 'TH', currency: 'THB', center: [15.87, 100.9925], motifs: ['golden temples', 'island water', 'street kitchens', 'river boats'], palette: PALETTES.gold },
  { name: 'Vietnam', code: 'VN', currency: 'VND', center: [14.0583, 108.2772], motifs: ['lantern streets', 'rice terraces', 'coffee stalls', 'limestone bays'], palette: PALETTES.jade },
  { name: 'Singapore', code: 'SG', currency: 'SGD', center: [1.3521, 103.8198], motifs: ['hawker centres', 'garden towers', 'shophouse rows', 'river walks'], palette: PALETTES.lagoon },
  { name: 'Malaysia', code: 'MY', currency: 'MYR', center: [4.2105, 101.9758], motifs: ['kopitiams', 'rainforest air', 'island coasts', 'heritage streets'], palette: PALETTES.jade },
  { name: 'Indonesia', code: 'ID', currency: 'IDR', center: [-2.5489, 118.0149], motifs: ['rice fields', 'volcano dawns', 'beach afternoons', 'temple stone'], palette: PALETTES.forest },
  { name: 'Philippines', code: 'PH', currency: 'PHP', center: [12.8797, 121.774], motifs: ['island hopping', 'turquoise water', 'lagoon coves', 'sunset boats'], palette: PALETTES.lagoon },
  { name: 'India', code: 'IN', currency: 'INR', center: [20.5937, 78.9629], motifs: ['spice markets', 'palace courtyards', 'river ghats', 'railway mornings'], palette: PALETTES.saffron },
  { name: 'Nepal', code: 'NP', currency: 'NPR', center: [28.3949, 84.124], motifs: ['himalayan ridges', 'prayer flags', 'stone courtyards', 'teahouse trails'], palette: PALETTES.alpine },
  { name: 'Sri Lanka', code: 'LK', currency: 'LKR', center: [7.8731, 80.7718], motifs: ['tea hills', 'coastal trains', 'temple bells', 'jungle roads'], palette: PALETTES.olive },
  { name: 'Maldives', code: 'MV', currency: 'MVR', center: [3.2028, 73.2207], motifs: ['lagoon water', 'reef mornings', 'overwater calm', 'sunset decks'], palette: PALETTES.lagoon },
  { name: 'Cambodia', code: 'KH', currency: 'KHR', center: [12.5657, 104.991], motifs: ['temple ruins', 'river villages', 'sunrise stone', 'market lanes'], palette: PALETTES.gold },
  { name: 'Laos', code: 'LA', currency: 'LAK', center: [19.8563, 102.4955], motifs: ['mekong slow boats', 'waterfalls', 'monk mornings', 'mountain mist'], palette: PALETTES.forest },
  { name: 'Australia', code: 'AU', currency: 'AUD', center: [-25.2744, 133.7751], motifs: ['coastal drives', 'reef water', 'outback light', 'city beaches'], palette: PALETTES.terracotta },
  { name: 'New Zealand', code: 'NZ', currency: 'NZD', center: [-40.9006, 174.886], motifs: ['fiords', 'alpine lakes', 'road trips', 'green valleys'], palette: PALETTES.aurora },
  { name: 'United Kingdom', code: 'GB', currency: 'GBP', center: [55.3781, -3.436], motifs: ['stone lanes', 'countryside walks', 'museum halls', 'pub evenings'], palette: PALETTES.midnight, aliases: ['uk', 'england', 'scotland', 'wales', 'britain'] },
  { name: 'Ireland', code: 'IE', currency: 'EUR', center: [53.1424, -7.6921], motifs: ['green cliffs', 'coastal roads', 'music pubs', 'castle ruins'], palette: PALETTES.forest },
  { name: 'France', code: 'FR', currency: 'EUR', center: [46.2276, 2.2137], motifs: ['boulangeries', 'river walks', 'gallery afternoons', 'vineyard roads'], palette: PALETTES.gold },
  { name: 'Italy', code: 'IT', currency: 'EUR', center: [41.8719, 12.5674], motifs: ['piazza evenings', 'coastal cliffs', 'espresso bars', 'old stone streets'], palette: PALETTES.terracotta },
  { name: 'Spain', code: 'ES', currency: 'EUR', center: [40.4637, -3.7492], motifs: ['tapas counters', 'tiled plazas', 'late sunsets', 'coastal towns'], palette: PALETTES.saffron },
  { name: 'Portugal', code: 'PT', currency: 'EUR', center: [39.3999, -8.2245], motifs: ['tiled facades', 'cliff coasts', 'pastry counters', 'tram hills'], palette: PALETTES.terracotta },
  { name: 'Germany', code: 'DE', currency: 'EUR', center: [51.1657, 10.4515], motifs: ['old towns', 'forest trails', 'river cities', 'market squares'], palette: PALETTES.midnight },
  { name: 'Switzerland', code: 'CH', currency: 'CHF', center: [46.8182, 8.2275], motifs: ['alpine trains', 'snow peaks', 'lake towns', 'mountain air'], palette: PALETTES.alpine },
  { name: 'Austria', code: 'AT', currency: 'EUR', center: [47.5162, 14.5501], motifs: ['concert halls', 'alpine valleys', 'coffee houses', 'castle views'], palette: PALETTES.alpine },
  { name: 'Netherlands', code: 'NL', currency: 'EUR', center: [52.1326, 5.2913], motifs: ['canal rings', 'bike lanes', 'gallery rooms', 'tulip fields'], palette: PALETTES.midnight },
  { name: 'Greece', code: 'GR', currency: 'EUR', center: [39.0742, 21.8243], motifs: ['island whites', 'ancient stone', 'aegean blue', 'seaside tavernas'], palette: PALETTES.alpine },
  { name: 'Iceland', code: 'IS', currency: 'ISK', center: [64.9631, -19.0208], motifs: ['glacier light', 'black beaches', 'hot springs', 'northern skies'], palette: PALETTES.aurora },
  { name: 'Norway', code: 'NO', currency: 'NOK', center: [60.472, 8.4689], motifs: ['fjord walls', 'coastal ferries', 'quiet cabins', 'midnight light'], palette: PALETTES.aurora },
  { name: 'Sweden', code: 'SE', currency: 'SEK', center: [60.1282, 18.6435], motifs: ['archipelago days', 'design streets', 'forest calm', 'fika breaks'], palette: PALETTES.alpine },
  { name: 'Denmark', code: 'DK', currency: 'DKK', center: [56.2639, 9.5018], motifs: ['harbour colour', 'bike streets', 'design cafés', 'coastal air'], palette: PALETTES.lagoon },
  { name: 'Finland', code: 'FI', currency: 'EUR', center: [61.9241, 25.7482], motifs: ['lake silence', 'sauna evenings', 'pine forest', 'arctic light'], palette: PALETTES.aurora },
  { name: 'Czechia', code: 'CZ', currency: 'CZK', center: [49.8175, 15.473], motifs: ['spired skylines', 'cobbled hills', 'beer halls', 'river bridges'], palette: PALETTES.terracotta, aliases: ['czech republic'] },
  { name: 'Poland', code: 'PL', currency: 'PLN', center: [51.9194, 19.1451], motifs: ['old squares', 'amber coast', 'milk bars', 'forest roads'], palette: PALETTES.crimson },
  { name: 'Hungary', code: 'HU', currency: 'HUF', center: [47.1625, 19.5033], motifs: ['thermal baths', 'danube nights', 'ruin bars', 'grand facades'], palette: PALETTES.gold },
  { name: 'Turkey', code: 'TR', currency: 'TRY', center: [38.9637, 35.2433], motifs: ['bazaar colour', 'domed skylines', 'coast roads', 'tea glasses'], palette: PALETTES.saffron },
  { name: 'United Arab Emirates', code: 'AE', currency: 'AED', center: [23.4241, 53.8478], motifs: ['desert dunes', 'glass towers', 'souk gold', 'warm nights'], palette: PALETTES.desert, aliases: ['uae', 'dubai'] },
  { name: 'Qatar', code: 'QA', currency: 'QAR', center: [25.3548, 51.1839], motifs: ['corniche walks', 'desert light', 'souq evenings', 'modern museums'], palette: PALETTES.desert },
  { name: 'Saudi Arabia', code: 'SA', currency: 'SAR', center: [23.8859, 45.0792], motifs: ['desert canyons', 'old town mud brick', 'date markets', 'wide horizons'], palette: PALETTES.desert },
  { name: 'Israel', code: 'IL', currency: 'ILS', center: [31.0461, 34.8516], motifs: ['old city stone', 'market spices', 'desert roads', 'sea evenings'], palette: PALETTES.desert },
  { name: 'Jordan', code: 'JO', currency: 'JOD', center: [30.5852, 36.2384], motifs: ['rock cities', 'desert camps', 'canyon walks', 'star skies'], palette: PALETTES.desert },
  { name: 'Egypt', code: 'EG', currency: 'EGP', center: [26.8206, 30.8025], motifs: ['temple columns', 'nile evenings', 'desert gold', 'market lanes'], palette: PALETTES.gold },
  { name: 'Morocco', code: 'MA', currency: 'MAD', center: [31.7917, -7.0926], motifs: ['medina colour', 'riad courtyards', 'desert dunes', 'mint tea'], palette: PALETTES.terracotta },
  { name: 'South Africa', code: 'ZA', currency: 'ZAR', center: [-30.5595, 22.9375], motifs: ['safari mornings', 'coastal drives', 'winelands', 'table mountain light'], palette: PALETTES.olive },
  { name: 'Kenya', code: 'KE', currency: 'KES', center: [-0.0236, 37.9062], motifs: ['savannah dawns', 'wildlife plains', 'rift valley', 'coastal towns'], palette: PALETTES.olive },
  { name: 'United States', code: 'US', currency: 'USD', center: [39.8283, -98.5795], motifs: ['road trips', 'skyline nights', 'national parks', 'diner mornings'], palette: PALETTES.midnight, aliases: ['usa', 'america', 'us'] },
  { name: 'Canada', code: 'CA', currency: 'CAD', center: [56.1304, -106.3468], motifs: ['mountain lakes', 'forest highways', 'harbour towns', 'snow air'], palette: PALETTES.alpine },
  { name: 'Mexico', code: 'MX', currency: 'MXN', center: [23.6345, -102.5528], motifs: ['colour streets', 'taco stands', 'ruin steps', 'coast towns'], palette: PALETTES.terracotta },
  { name: 'Brazil', code: 'BR', currency: 'BRL', center: [-14.235, -51.9253], motifs: ['beach mornings', 'rainforest air', 'street music', 'mountain views'], palette: PALETTES.forest },
  { name: 'Argentina', code: 'AR', currency: 'ARS', center: [-38.4161, -63.6167], motifs: ['tango nights', 'wine valleys', 'glacier fields', 'grill dinners'], palette: PALETTES.crimson },
  { name: 'Peru', code: 'PE', currency: 'PEN', center: [-9.19, -75.0152], motifs: ['andes ridges', 'inca stone', 'market colour', 'high plains'], palette: PALETTES.terracotta },
  { name: 'Chile', code: 'CL', currency: 'CLP', center: [-35.6751, -71.543], motifs: ['desert skies', 'patagonia wind', 'coastal hills', 'vineyard valleys'], palette: PALETTES.alpine },
];

const FALLBACK_COUNTRY: CountryProfile = {
  name: 'Somewhere new',
  code: '',
  currency: 'USD',
  center: [20, 0],
  motifs: ['new streets', 'local food', 'slow mornings', 'unfamiliar views'],
  palette: PALETTES.rose,
};

const normalize = (value: string) => value.trim().toLowerCase();

export const listCountries = (): CountryProfile[] => COUNTRIES;

/** Regional-indicator flag for an ISO 3166-1 alpha-2 code. */
export function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌍';
  return String.fromCodePoint(...[...code.toUpperCase()].map((letter) => 0x1f1a5 + letter.charCodeAt(0)));
}

/** Ranked country matches for the picker: prefix hits first, then contains. */
export function searchCountries(query: string, limit = 8): CountryProfile[] {
  const needle = normalize(query);
  if (!needle) return COUNTRIES.slice(0, limit);

  const startsWith: CountryProfile[] = [];
  const contains: CountryProfile[] = [];
  for (const country of COUNTRIES) {
    const name = normalize(country.name);
    const aliasHit = country.aliases?.some((alias) => normalize(alias).startsWith(needle));
    if (name.startsWith(needle) || aliasHit || normalize(country.code) === needle) startsWith.push(country);
    else if (name.includes(needle)) contains.push(country);
  }
  return [...startsWith, ...contains].slice(0, limit);
}

export function findCountry(query: string | undefined | null): CountryProfile | null {
  if (!query) return null;
  const needle = normalize(query);
  if (!needle) return null;
  return (
    COUNTRIES.find((country) => normalize(country.name) === needle)
    || COUNTRIES.find((country) => normalize(country.code) === needle)
    || COUNTRIES.find((country) => country.aliases?.some((alias) => normalize(alias) === needle))
    || COUNTRIES.find((country) => normalize(country.name).includes(needle) && needle.length >= 4)
    || null
  );
}

export const countryOrFallback = (query: string | undefined | null): CountryProfile =>
  findCountry(query) || FALLBACK_COUNTRY;

/** Well-known city centers so the map is useful before any network call. */
const CITY_CENTERS: Record<string, [number, number]> = {
  tokyo: [35.6762, 139.6503],
  kyoto: [35.0116, 135.7681],
  osaka: [34.6937, 135.5023],
  nara: [34.6851, 135.8048],
  sapporo: [43.0618, 141.3545],
  fukuoka: [33.5904, 130.4017],
  hakone: [35.2324, 139.1069],
  seoul: [37.5665, 126.978],
  busan: [35.1796, 129.0756],
  jeju: [33.4996, 126.5312],
  beijing: [39.9042, 116.4074],
  shanghai: [31.2304, 121.4737],
  guangzhou: [23.1291, 113.2644],
  shenzhen: [22.5431, 114.0579],
  chengdu: [30.5728, 104.0668],
  chongqing: [29.563, 106.5516],
  xian: [34.3416, 108.9398],
  taipei: [25.033, 121.5654],
  kaohsiung: [22.6273, 120.3014],
  'hong kong': [22.3193, 114.1694],
  macau: [22.1987, 113.5439],
  bangkok: [13.7563, 100.5018],
  'chiang mai': [18.7883, 98.9853],
  phuket: [7.8804, 98.3923],
  hanoi: [21.0278, 105.8342],
  'ho chi minh city': [10.8231, 106.6297],
  'da nang': [16.0544, 108.2022],
  'hoi an': [15.8801, 108.338],
  singapore: [1.3521, 103.8198],
  'kuala lumpur': [3.139, 101.6869],
  penang: [5.4141, 100.3288],
  'george town': [5.4141, 100.3288],
  malacca: [2.1896, 102.2501],
  'kota kinabalu': [5.9804, 116.0735],
  langkawi: [6.3529, 99.8],
  bali: [-8.4095, 115.1889],
  denpasar: [-8.6705, 115.2126],
  ubud: [-8.5069, 115.2625],
  jakarta: [-6.2088, 106.8456],
  manila: [14.5995, 120.9842],
  cebu: [10.3157, 123.8854],
  delhi: [28.6139, 77.209],
  mumbai: [19.076, 72.8777],
  jaipur: [26.9124, 75.7873],
  kathmandu: [27.7172, 85.324],
  colombo: [6.9271, 79.8612],
  'siem reap': [13.3671, 103.8448],
  'luang prabang': [19.8834, 102.1347],
  sydney: [-33.8688, 151.2093],
  melbourne: [-37.8136, 144.9631],
  brisbane: [-27.4698, 153.0251],
  perth: [-31.9523, 115.8613],
  auckland: [-36.8485, 174.7633],
  queenstown: [-45.0312, 168.6626],
  london: [51.5074, -0.1278],
  edinburgh: [55.9533, -3.1883],
  dublin: [53.3498, -6.2603],
  paris: [48.8566, 2.3522],
  nice: [43.7102, 7.262],
  lyon: [45.764, 4.8357],
  rome: [41.9028, 12.4964],
  florence: [43.7696, 11.2558],
  venice: [45.4408, 12.3155],
  milan: [45.4642, 9.19],
  barcelona: [41.3851, 2.1734],
  madrid: [40.4168, -3.7038],
  seville: [37.3891, -5.9845],
  lisbon: [38.7223, -9.1393],
  porto: [41.1579, -8.6291],
  berlin: [52.52, 13.405],
  munich: [48.1351, 11.582],
  zurich: [47.3769, 8.5417],
  interlaken: [46.6863, 7.8632],
  lucerne: [47.0502, 8.3093],
  zermatt: [46.0207, 7.7491],
  vienna: [48.2082, 16.3738],
  amsterdam: [52.3676, 4.9041],
  athens: [37.9838, 23.7275],
  santorini: [36.3932, 25.4615],
  reykjavik: [64.1466, -21.9426],
  oslo: [59.9139, 10.7522],
  bergen: [60.3913, 5.3221],
  stockholm: [59.3293, 18.0686],
  copenhagen: [55.6761, 12.5683],
  helsinki: [60.1699, 24.9384],
  prague: [50.0755, 14.4378],
  krakow: [50.0647, 19.945],
  budapest: [47.4979, 19.0402],
  istanbul: [41.0082, 28.9784],
  cappadocia: [38.6431, 34.8289],
  dubai: [25.2048, 55.2708],
  'abu dhabi': [24.4539, 54.3773],
  doha: [25.2854, 51.531],
  cairo: [30.0444, 31.2357],
  marrakesh: [31.6295, -7.9811],
  'cape town': [-33.9249, 18.4241],
  nairobi: [-1.2921, 36.8219],
  'new york': [40.7128, -74.006],
  'san francisco': [37.7749, -122.4194],
  'los angeles': [34.0522, -118.2437],
  chicago: [41.8781, -87.6298],
  seattle: [47.6062, -122.3321],
  toronto: [43.6532, -79.3832],
  vancouver: [49.2827, -123.1207],
  'mexico city': [19.4326, -99.1332],
  'rio de janeiro': [-22.9068, -43.1729],
  'buenos aires': [-34.6037, -58.3816],
  cusco: [-13.5319, -71.9675],
  lima: [-12.0464, -77.0428],
  santiago: [-33.4489, -70.6693],
};

export function lookupCityCenter(city: string): [number, number] | null {
  const key = normalize(city);
  if (!key) return null;
  if (CITY_CENTERS[key]) return CITY_CENTERS[key];
  const partial = Object.keys(CITY_CENTERS).find((name) => key.includes(name) || name.includes(key));
  return partial ? CITY_CENTERS[partial] : null;
}

/** Quick-add suggestions shown as soon as a country is chosen. */
const POPULAR_CITIES: Record<string, string[]> = {
  JP: ['Tokyo', 'Kyoto', 'Osaka', 'Nara', 'Sapporo', 'Fukuoka'],
  KR: ['Seoul', 'Busan', 'Jeju'],
  CN: ['Beijing', 'Shanghai', 'Chengdu', 'Guangzhou', 'Xian'],
  TW: ['Taipei', 'Kaohsiung'],
  HK: ['Hong Kong'],
  TH: ['Bangkok', 'Chiang Mai', 'Phuket'],
  VN: ['Hanoi', 'Ho Chi Minh City', 'Da Nang', 'Hoi An'],
  SG: ['Singapore'],
  MY: ['Kuala Lumpur', 'Penang', 'Malacca', 'Kota Kinabalu', 'Langkawi'],
  ID: ['Bali', 'Ubud', 'Jakarta'],
  PH: ['Manila', 'Cebu'],
  IN: ['Delhi', 'Mumbai', 'Jaipur'],
  NP: ['Kathmandu'],
  LK: ['Colombo'],
  KH: ['Siem Reap'],
  LA: ['Luang Prabang'],
  AU: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'],
  NZ: ['Auckland', 'Queenstown'],
  GB: ['London', 'Edinburgh'],
  IE: ['Dublin'],
  FR: ['Paris', 'Nice', 'Lyon'],
  IT: ['Rome', 'Florence', 'Venice', 'Milan'],
  ES: ['Barcelona', 'Madrid', 'Seville'],
  PT: ['Lisbon', 'Porto'],
  DE: ['Berlin', 'Munich'],
  CH: ['Zurich', 'Interlaken', 'Lucerne', 'Zermatt'],
  AT: ['Vienna'],
  NL: ['Amsterdam'],
  GR: ['Athens', 'Santorini'],
  IS: ['Reykjavik'],
  NO: ['Oslo', 'Bergen'],
  SE: ['Stockholm'],
  DK: ['Copenhagen'],
  FI: ['Helsinki'],
  CZ: ['Prague'],
  PL: ['Krakow'],
  HU: ['Budapest'],
  TR: ['Istanbul', 'Cappadocia'],
  AE: ['Dubai', 'Abu Dhabi'],
  QA: ['Doha'],
  EG: ['Cairo'],
  MA: ['Marrakesh'],
  ZA: ['Cape Town'],
  KE: ['Nairobi'],
  US: ['New York', 'San Francisco', 'Los Angeles', 'Chicago', 'Seattle'],
  CA: ['Toronto', 'Vancouver'],
  MX: ['Mexico City'],
  BR: ['Rio de Janeiro'],
  AR: ['Buenos Aires'],
  PE: ['Cusco', 'Lima'],
  CL: ['Santiago'],
};

export const popularCities = (countryCode: string | undefined): string[] =>
  (countryCode && POPULAR_CITIES[countryCode.toUpperCase()]) || [];

/**
 * IANA zones for countries that observe a single time zone. Geocoding does not
 * return a time zone, and guessing one for a country that spans several (the
 * United States, Australia, Brazil) would be worse than admitting we do not
 * know, so those are deliberately absent.
 */
const COUNTRY_TIMEZONES: Record<string, string> = {
  JP: 'Asia/Tokyo', KR: 'Asia/Seoul', CN: 'Asia/Shanghai', TW: 'Asia/Taipei',
  HK: 'Asia/Hong_Kong', TH: 'Asia/Bangkok', VN: 'Asia/Ho_Chi_Minh', SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur', PH: 'Asia/Manila', IN: 'Asia/Kolkata', NP: 'Asia/Kathmandu',
  LK: 'Asia/Colombo', MV: 'Indian/Maldives', KH: 'Asia/Phnom_Penh', LA: 'Asia/Vientiane',
  NZ: 'Pacific/Auckland', GB: 'Europe/London', IE: 'Europe/Dublin', FR: 'Europe/Paris',
  IT: 'Europe/Rome', ES: 'Europe/Madrid', PT: 'Europe/Lisbon', DE: 'Europe/Berlin',
  CH: 'Europe/Zurich', AT: 'Europe/Vienna', NL: 'Europe/Amsterdam', BE: 'Europe/Brussels',
  GR: 'Europe/Athens', IS: 'Atlantic/Reykjavik', NO: 'Europe/Oslo', SE: 'Europe/Stockholm',
  DK: 'Europe/Copenhagen', FI: 'Europe/Helsinki', CZ: 'Europe/Prague', PL: 'Europe/Warsaw',
  HU: 'Europe/Budapest', TR: 'Europe/Istanbul', AE: 'Asia/Dubai', QA: 'Asia/Qatar',
  SA: 'Asia/Riyadh', IL: 'Asia/Jerusalem', JO: 'Asia/Amman', EG: 'Africa/Cairo',
  MA: 'Africa/Casablanca', ZA: 'Africa/Johannesburg', KE: 'Africa/Nairobi',
  PE: 'America/Lima', AR: 'America/Argentina/Buenos_Aires',
};

/** IANA zone for a country, or undefined when the country spans several. */
export const countryTimezone = (countryCode: string | undefined): string | undefined =>
  countryCode ? COUNTRY_TIMEZONES[countryCode.toUpperCase()] : undefined;

const slug = (value: string) =>
  normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'place';

/**
 * Stable identity for a saved stop. Provider IDs are preferred; without one we
 * fall back to a slug that still includes the country, so Georgetown in
 * Malaysia and Georgetown in Guyana never collide.
 */
export function createDestinationId(parts: {
  city: string;
  countryCode?: string;
  providerPlaceId?: string;
}): string {
  const country = (parts.countryCode || 'xx').toLowerCase();
  const base = `place_${slug(parts.city)}_${country}`;
  return parts.providerPlaceId ? `${base}_${parts.providerPlaceId}` : base;
}

export interface PlaceSuggestion {
  id: string;
  city: string;
  region?: string;
  country: string;
  countryCode?: string;
  lat: number;
  lng: number;
  provider: 'nominatim' | 'offline';
  providerPlaceId?: string;
  timezone?: string;
  currencyCode?: string;
}

interface NominatimResult {
  place_id?: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
    country_code?: string;
  };
}

const toSuggestion = (result: NominatimResult): PlaceSuggestion | null => {
  const lat = Number(result.lat);
  const lng = Number(result.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const address = result.address || {};
  const city =
    address.city || address.town || address.village || address.municipality
    || result.name || result.display_name.split(',')[0];
  if (!city) return null;

  const countryCode = address.country_code?.toUpperCase();
  const providerPlaceId = result.place_id !== undefined ? String(result.place_id) : undefined;
  const countryProfile = countryCode ? findCountry(countryCode) : null;

  return {
    id: createDestinationId({ city, countryCode, providerPlaceId }),
    city,
    region: address.state && address.state !== city ? address.state : address.county,
    country: address.country || countryProfile?.name || '',
    countryCode,
    lat,
    lng,
    provider: 'nominatim',
    providerPlaceId,
    timezone: countryTimezone(countryCode),
    currencyCode: countryProfile?.currency,
  };
};

/** A suggestion built from the offline table, used by quick-pick chips. */
export function offlinePlace(city: string, countryCode?: string): PlaceSuggestion {
  const country = countryCode ? findCountry(countryCode) : null;
  const center = lookupCityCenter(city);
  return {
    id: createDestinationId({ city, countryCode: country?.code }),
    city,
    country: country?.name || '',
    countryCode: country?.code,
    lat: center?.[0] ?? country?.center[0] ?? 0,
    lng: center?.[1] ?? country?.center[1] ?? 0,
    provider: 'offline',
    timezone: countryTimezone(country?.code),
    currencyCode: country?.currency,
  };
}

/** Offline matches so the picker still suggests something without a network. */
function offlineSuggestions(query: string, country?: CountryProfile | null): PlaceSuggestion[] {
  const needle = normalize(query);
  const pool = country ? popularCities(country.code).map(normalize) : [];
  const keys = Array.from(new Set([...pool, ...Object.keys(CITY_CENTERS)]));

  return keys
    .filter((key) => (needle ? key.includes(needle) : pool.includes(key)))
    .slice(0, 6)
    .flatMap((key): PlaceSuggestion[] => {
      const point = CITY_CENTERS[key];
      if (!point) return [];
      const city = key.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
      return [{
        id: createDestinationId({ city, countryCode: country?.code }),
        city,
        country: country?.name || '',
        countryCode: country?.code,
        lat: point[0],
        lng: point[1],
        provider: 'offline',
        timezone: countryTimezone(country?.code),
        currencyCode: country?.currency,
      }];
    });
}

/* -------------------------------------------------------------------------- */
/* Place search                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Search is backed by OpenStreetMap's Nominatim, whose usage policy allows at
 * most one request per second per application and asks that autocomplete not
 * hammer it. Browsers will not let us set a User-Agent, so the request carries
 * the page's Referer instead; a small backend proxy would be the better long
 * term home for this, and everything below is written so only the transport
 * would need to change.
 *
 * Protections here: a minimum query length, an in-memory cache of recent
 * queries, at least one second between network calls, and a silent fall back
 * to the offline city table when the provider errors or rate-limits.
 */
const PLACE_PROVIDER = 'https://nominatim.openstreetmap.org/search';
export const MIN_PLACE_QUERY_LENGTH = 3;
const PROVIDER_MIN_INTERVAL_MS = 1100;
const PLACE_CACHE_LIMIT = 60;

const placeCache = new Map<string, PlaceSuggestion[]>();
let lastProviderCallAt = 0;

const cacheKey = (query: string, countryCode?: string) =>
  `${(countryCode || '').toUpperCase()}|${normalize(query)}`;

const rememberPlaces = (key: string, suggestions: PlaceSuggestion[]) => {
  placeCache.set(key, suggestions);
  if (placeCache.size > PLACE_CACHE_LIMIT) {
    const oldest = placeCache.keys().next().value;
    if (oldest !== undefined) placeCache.delete(oldest);
  }
};

/** Test seam: forget cached searches and the rate-limit window. */
export const resetPlaceCache = () => {
  placeCache.clear();
  lastProviderCallAt = 0;
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

export interface PlaceSearchResult {
  suggestions: PlaceSuggestion[];
  /** Where the results came from, so the UI can be honest about it. */
  source: 'provider' | 'cache' | 'offline';
  /** Set when the provider could not be reached or refused the request. */
  unavailable?: boolean;
}

/** Autocomplete places, optionally scoped to one country. */
export async function searchPlaces(
  query: string,
  options: { countryCode?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<PlaceSearchResult> {
  const trimmed = query.trim();
  const country = options.countryCode ? findCountry(options.countryCode) : null;

  if (trimmed.length < MIN_PLACE_QUERY_LENGTH) {
    return { suggestions: offlineSuggestions('', country), source: 'offline' };
  }

  const key = cacheKey(trimmed, options.countryCode);
  const cached = placeCache.get(key);
  if (cached) return { suggestions: cached, source: 'cache' };

  try {
    const sinceLastCall = Date.now() - lastProviderCallAt;
    if (sinceLastCall < PROVIDER_MIN_INTERVAL_MS) {
      await wait(PROVIDER_MIN_INTERVAL_MS - sinceLastCall, options.signal);
    }
    // A newer keystroke may have aborted this search while it waited its turn.
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const url = new URL(PLACE_PROVIDER);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(options.limit ?? 6));
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('featureType', 'settlement');
    url.searchParams.set('q', trimmed);
    if (options.countryCode) url.searchParams.set('countrycodes', options.countryCode.toLowerCase());

    lastProviderCallAt = Date.now();
    const response = await fetch(url.toString(), {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Place search failed (${response.status})`);

    const results = (await response.json()) as NominatimResult[];
    const suggestions = results
      .map(toSuggestion)
      .filter((item): item is PlaceSuggestion => item !== null);

    if (suggestions.length === 0) {
      return { suggestions: offlineSuggestions(trimmed, country), source: 'offline' };
    }

    rememberPlaces(key, suggestions);
    return { suggestions, source: 'provider' };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return {
      suggestions: offlineSuggestions(trimmed, country),
      source: 'offline',
      unavailable: true,
    };
  }
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
  country?: string;
}

/**
 * Look a place up via OpenStreetMap. Falls back to the offline city table so
 * trip creation still works without a network.
 */
export async function geocodePlace(query: string, signal?: AbortSignal): Promise<GeocodeResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('q', trimmed);

    const response = await fetch(url.toString(), {
      signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Geocoding failed');
    const results = (await response.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
      address?: { country?: string };
    }>;
    const first = results[0];
    if (first) {
      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng, displayName: first.display_name, country: first.address?.country };
      }
    }
  } catch {
    // Fall through to the offline table.
  }

  const offline = lookupCityCenter(trimmed);
  return offline ? { lat: offline[0], lng: offline[1], displayName: trimmed } : null;
}
