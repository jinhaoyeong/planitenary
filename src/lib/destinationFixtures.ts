import type {
  DateAwareOpeningHours,
  DestinationKnowledgePack,
  DiscoveryRequest,
  PlaceCandidate,
  PlaceCandidateDetails,
  PlaceDiscoveryProvider,
} from './destinationIntelligence';

const VERIFIED_AT = '2026-08-04T00:00:00.000Z';
const OSAKA_INFO = 'https://osaka-info.jp/en/spot/';
const JNTO_OSAKA = 'https://www.japan.travel/en/destinations/kansai/osaka/';

const hours = (opensAt: string, closesAt: string, confidence: DateAwareOpeningHours['sourceConfidence'] = 'medium'): DateAwareOpeningHours => ({
  timezone: 'Asia/Tokyo',
  periods: [{ opensAt, closesAt }],
  sourceConfidence: confidence,
});

type FixtureInput = Omit<PlaceCandidate,
  'id' | 'provider' | 'providerPlaceId' | 'countryCode' | 'region' | 'city' | 'sourceConfidence' | 'sourceReferences' | 'lastVerifiedAt'
> & {
  slug: string;
  city?: string;
  sourceUrl?: string;
  sourceLabel?: string;
};

const osaka = ({ slug, sourceUrl = OSAKA_INFO, sourceLabel = 'OSAKA-INFO official tourism guide', ...candidate }: FixtureInput): PlaceCandidate => ({
  ...candidate,
  id: `osaka-${slug}`,
  provider: 'official-tourism',
  providerPlaceId: `osaka-info:${slug}`,
  countryCode: 'JP',
  region: 'Kansai',
  city: candidate.city || 'Osaka',
  sourceConfidence: candidate.openingHours ? 'medium' : 'high',
  sourceReferences: [{ label: sourceLabel, url: sourceUrl, retrievedAt: VERIFIED_AT }],
  lastVerifiedAt: VERIFIED_AT,
});

export const OSAKA_PLACE_FIXTURE: PlaceCandidate[] = [
  osaka({ slug: 'dotonbori', name: 'Dotonbori', description: 'Osaka’s Minami entertainment district, strongest after dark.', neighbourhood: 'Minami', coordinates: [34.6687, 135.5013], categories: ['evening', 'food-district'], experienceTags: ['street-food', 'nightlife', 'photography'], estimatedVisitMinutes: 120, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', bestTimeWindows: [{ start: '17:00', end: '22:00' }], priceLevel: 1, sourceUrl: `${OSAKA_INFO}dotonbori/` }),
  osaka({ slug: 'hozenji', name: 'Hozenji Temple', description: 'A compact temple and lantern-lit alley just off Dotonbori.', neighbourhood: 'Minami', coordinates: [34.6676, 135.502], categories: ['temple', 'local-character'], experienceTags: ['history', 'hidden-gems', 'nightlife'], estimatedVisitMinutes: 45, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', bestTimeWindows: [{ start: '16:00', end: '20:00' }], priceLevel: 0, openingHours: hours('06:00', '23:00', 'low'), sourceUrl: JNTO_OSAKA, sourceLabel: 'Japan National Tourism Organization Osaka guide' }),
  osaka({ slug: 'kuromon-market', name: 'Kuromon Ichiba Market', description: 'A covered market known for seafood, produce and casual tastings.', neighbourhood: 'Minami', coordinates: [34.6654, 135.5064], categories: ['market', 'food'], experienceTags: ['street-food', 'shopping'], estimatedVisitMinutes: 120, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', bestTimeWindows: [{ start: '09:30', end: '13:30' }], priceLevel: 2, openingHours: hours('09:00', '18:00', 'low'), sourceUrl: JNTO_OSAKA, sourceLabel: 'Japan National Tourism Organization Osaka guide' }),
  osaka({ slug: 'shinsaibashi-suji', name: 'Shinsaibashi-suji Shopping Street', description: 'A long covered shopping street connecting central Minami districts.', neighbourhood: 'Minami', coordinates: [34.6751, 135.5014], categories: ['shopping', 'local-character'], experienceTags: ['shopping', 'architecture'], estimatedVisitMinutes: 120, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 2, openingHours: hours('10:00', '20:00', 'low'), sourceUrl: JNTO_OSAKA, sourceLabel: 'Japan National Tourism Organization Osaka guide' }),
  osaka({ slug: 'namba-yasaka', name: 'Namba Yasaka Shrine', description: 'A neighbourhood shrine recognised for its monumental lion-head stage.', neighbourhood: 'Namba', coordinates: [34.6604, 135.4965], categories: ['shrine', 'architecture'], experienceTags: ['temples', 'photography', 'hidden-gems'], estimatedVisitMinutes: 50, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 0, openingHours: hours('06:30', '17:00', 'medium'), sourceUrl: `${OSAKA_INFO}namba-yasaka-jinja/` }),
  osaka({ slug: 'osaka-castle-museum', name: 'Osaka Castle Museum', description: 'The city’s landmark history museum inside the reconstructed main keep.', neighbourhood: 'Osaka Castle', coordinates: [34.6873, 135.5262], categories: ['essential', 'history', 'museum'], experienceTags: ['history', 'architecture', 'museums'], estimatedVisitMinutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 1, openingHours: hours('09:00', '18:00', 'medium'), sourceUrl: `${OSAKA_INFO}osaka-castle-main-keep/` }),
  osaka({ slug: 'osaka-castle-park', name: 'Osaka Castle Park', description: 'Extensive grounds surrounding the castle, moats and historic stonework.', neighbourhood: 'Osaka Castle', coordinates: [34.6873, 135.5259], categories: ['park', 'essential'], experienceTags: ['nature', 'walking', 'photography'], estimatedVisitMinutes: 90, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 0, sourceUrl: `${OSAKA_INFO}area_osakacastle/index.html` }),
  osaka({ slug: 'nishinomaru-garden', name: 'Nishinomaru Garden', description: 'A quieter lawn and garden with a classic view toward Osaka Castle.', neighbourhood: 'Osaka Castle', coordinates: [34.6887, 135.5233], categories: ['garden', 'view'], experienceTags: ['nature', 'photography', 'slow-living'], estimatedVisitMinutes: 75, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('09:00', '17:00', 'medium'), sourceUrl: `${OSAKA_INFO}area_osakacastle/index.html` }),
  osaka({ slug: 'osaka-museum-history', name: 'Osaka Museum of History', description: 'City history galleries with elevated views over the castle precinct.', neighbourhood: 'Osaka Castle', coordinates: [34.6824, 135.5206], categories: ['museum', 'history'], experienceTags: ['museums', 'history', 'architecture'], estimatedVisitMinutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('09:30', '17:00', 'medium'), sourceUrl: `${OSAKA_INFO}area_osakacastle/index.html` }),
  osaka({ slug: 'nakanoshima-museum-art', name: 'Nakanoshima Museum of Art, Osaka', description: 'Modern and contemporary art in Osaka’s river-island museum district.', neighbourhood: 'Nakanoshima', coordinates: [34.6913, 135.4931], categories: ['museum', 'art'], experienceTags: ['museums', 'architecture', 'calm'], estimatedVisitMinutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 2, openingHours: hours('10:00', '17:00', 'medium'), sourceUrl: JNTO_OSAKA, sourceLabel: 'Japan National Tourism Organization northern Osaka guide' }),
  osaka({ slug: 'osaka-science-museum', name: 'Osaka Science Museum', description: 'Hands-on science exhibits and a planetarium beside the river.', neighbourhood: 'Nakanoshima', coordinates: [34.691, 135.4914], categories: ['museum', 'family'], experienceTags: ['museums', 'architecture'], estimatedVisitMinutes: 150, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 1, openingHours: hours('09:30', '17:00', 'medium'), sourceUrl: JNTO_OSAKA, sourceLabel: 'Japan National Tourism Organization northern Osaka guide' }),
  osaka({ slug: 'tenjinbashisuji', name: 'Tenjinbashisuji Shopping Street', description: 'A long local arcade suited to browsing and an informal food crawl.', neighbourhood: 'Tenma', coordinates: [34.7063, 135.5102], categories: ['market', 'local-character'], experienceTags: ['street-food', 'shopping', 'hidden-gems'], estimatedVisitMinutes: 150, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('10:00', '20:00', 'low'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/shin-osaka-station-and-umeda/', sourceLabel: 'Japan National Tourism Organization northern Osaka guide' }),
  osaka({ slug: 'housing-living', name: 'Osaka Museum of Housing and Living', description: 'A recreated Edo-period streetscape above the Tenjinbashisuji area.', neighbourhood: 'Tenma', coordinates: [34.7108, 135.511], categories: ['museum', 'history'], experienceTags: ['museums', 'history', 'architecture'], estimatedVisitMinutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 1, openingHours: hours('10:00', '17:00', 'medium'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/shin-osaka-station-and-umeda/', sourceLabel: 'Japan National Tourism Organization northern Osaka guide' }),
  osaka({ slug: 'umeda-sky-building', name: 'Umeda Sky Building Observatory', description: 'A rooftop observatory overlooking northern Osaka, best toward sunset.', neighbourhood: 'Umeda', coordinates: [34.7053, 135.4901], categories: ['view', 'architecture', 'essential'], experienceTags: ['architecture', 'photography', 'nightlife'], estimatedVisitMinutes: 100, indoorOutdoor: 'mixed', reservationStatus: 'recommended', priceLevel: 2, openingHours: hours('09:30', '22:30', 'medium'), bestTimeWindows: [{ start: '16:30', end: '20:30' }], sourceUrl: `${OSAKA_INFO}umeda-sky-building/` }),
  osaka({ slug: 'grand-front-osaka', name: 'Grand Front Osaka', description: 'Contemporary shopping and public spaces directly beside Osaka Station.', neighbourhood: 'Umeda', coordinates: [34.7049, 135.4949], categories: ['shopping', 'architecture'], experienceTags: ['shopping', 'architecture', 'cafes'], estimatedVisitMinutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'not-needed', priceLevel: 2, openingHours: hours('11:00', '21:00', 'low'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/shin-osaka-station-and-umeda/', sourceLabel: 'Japan National Tourism Organization northern Osaka guide' }),
  osaka({ slug: 'shinsekai', name: 'Shinsekai', description: 'A retro downtown district of neon signs, kushikatsu counters and old Osaka atmosphere.', neighbourhood: 'Shinsekai', coordinates: [34.6524, 135.5063], categories: ['local-character', 'food-district', 'evening'], experienceTags: ['street-food', 'nightlife', 'photography'], estimatedVisitMinutes: 150, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 1, sourceUrl: `${OSAKA_INFO}shinsekai/` }),
  osaka({ slug: 'tsutenkaku', name: 'Tsutenkaku Tower', description: 'The observation tower at the centre of Osaka’s retro Shinsekai district.', neighbourhood: 'Shinsekai', coordinates: [34.6525, 135.5063], categories: ['view', 'local-character'], experienceTags: ['architecture', 'photography', 'nightlife'], estimatedVisitMinutes: 75, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 1, openingHours: hours('10:00', '20:00', 'medium'), sourceUrl: `${OSAKA_INFO}shinsekai/` }),
  osaka({ slug: 'shitennoji', name: 'Shitennoji Temple', description: 'One of Japan’s oldest Buddhist temple complexes, close to Tennoji.', neighbourhood: 'Tennoji', coordinates: [34.6546, 135.5164], categories: ['temple', 'history'], experienceTags: ['temples', 'history', 'architecture'], estimatedVisitMinutes: 100, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('08:30', '16:30', 'medium'), sourceUrl: `${OSAKA_INFO}shitennoji/` }),
  osaka({ slug: 'osaka-city-fine-arts', name: 'Osaka City Museum of Fine Arts', description: 'A historic art museum in Tennoji Park, reopened after major renovation.', neighbourhood: 'Tennoji', coordinates: [34.6493, 135.5111], categories: ['museum', 'art'], experienceTags: ['museums', 'architecture'], estimatedVisitMinutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 1, openingHours: hours('09:30', '17:00', 'medium'), sourceUrl: `${OSAKA_INFO}` }),
  osaka({ slug: 'abeno-harukas', name: 'Abeno Harukas Observatory', description: 'A high-rise city panorama above the Tennoji transport hub.', neighbourhood: 'Tennoji', coordinates: [34.6459, 135.5134], categories: ['view', 'architecture'], experienceTags: ['architecture', 'photography', 'nightlife'], estimatedVisitMinutes: 90, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 2, openingHours: hours('09:00', '22:00', 'medium'), bestTimeWindows: [{ start: '16:30', end: '20:30' }], sourceUrl: `${OSAKA_INFO}` }),
  osaka({ slug: 'kaiyukan', name: 'Osaka Aquarium Kaiyukan', description: 'A major aquarium arranged around Pacific Ocean habitats and a central tank.', neighbourhood: 'Osaka Bay', coordinates: [34.6545, 135.4289], categories: ['essential', 'aquarium', 'family'], experienceTags: ['wildlife', 'photography', 'nature'], estimatedVisitMinutes: 180, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 3, openingHours: hours('10:00', '20:00', 'medium'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/osaka-bay-area/', sourceLabel: 'Japan National Tourism Organization Osaka Bay guide' }),
  osaka({ slug: 'tempozan', name: 'Tempozan Harbor Village', description: 'A waterfront promenade and marketplace beside Kaiyukan.', neighbourhood: 'Osaka Bay', coordinates: [34.655, 135.43], categories: ['waterfront', 'shopping'], experienceTags: ['shopping', 'cafes', 'slow-living'], estimatedVisitMinutes: 100, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('10:00', '20:00', 'low'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/osaka-bay-area/', sourceLabel: 'Japan National Tourism Organization Osaka Bay guide' }),
  osaka({ slug: 'santa-maria-cruise', name: 'Osaka Bay Cruise Santa Maria', description: 'A sightseeing cruise departing from the Tempozan waterfront.', neighbourhood: 'Osaka Bay', coordinates: [34.6551, 135.4295], categories: ['waterfront', 'experience'], experienceTags: ['scenic-train', 'photography', 'nature'], estimatedVisitMinutes: 60, indoorOutdoor: 'mixed', reservationStatus: 'recommended', priceLevel: 2, openingHours: hours('11:00', '17:00', 'low'), sourceUrl: `${OSAKA_INFO}` }),
  osaka({ slug: 'universal-studios-japan', name: 'Universal Studios Japan', description: 'A full-day theme park in the Osaka Bay area.', neighbourhood: 'Osaka Bay', coordinates: [34.6654, 135.4323], categories: ['theme-park', 'family'], experienceTags: ['anime', 'festive', 'nightlife'], estimatedVisitMinutes: 540, indoorOutdoor: 'mixed', reservationStatus: 'required', priceLevel: 4, openingHours: hours('09:00', '21:00', 'low'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/osaka-bay-area/', sourceLabel: 'Japan National Tourism Organization Osaka Bay guide' }),
  osaka({ slug: 'sumiyoshi-taisha', name: 'Sumiyoshi Taisha', description: 'A major Shinto shrine known for its distinctive architecture and arched bridge.', neighbourhood: 'Sumiyoshi', coordinates: [34.6128, 135.4929], categories: ['shrine', 'history'], experienceTags: ['temples', 'architecture', 'photography'], estimatedVisitMinutes: 100, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 0, openingHours: hours('06:00', '17:00', 'medium'), sourceUrl: `${OSAKA_INFO}` }),
  osaka({ slug: 'cup-noodles-museum', name: 'Cup Noodles Museum Osaka Ikeda', description: 'An interactive museum exploring instant noodle history and design.', neighbourhood: 'Ikeda', coordinates: [34.8179, 135.4297], categories: ['museum', 'experience'], experienceTags: ['museums', 'food', 'family'], estimatedVisitMinutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 1, openingHours: hours('09:30', '16:30', 'medium'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/ikeda-and-northern-osaka/', sourceLabel: 'Japan National Tourism Organization Ikeda guide' }),
  osaka({ slug: 'expo-70-park', name: 'Expo ’70 Commemorative Park', description: 'Large gardens, museums and the Tower of the Sun in northern Osaka.', neighbourhood: 'Suita', coordinates: [34.809, 135.5328], categories: ['park', 'art', 'history'], experienceTags: ['nature', 'architecture', 'museums'], estimatedVisitMinutes: 240, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('09:30', '17:00', 'medium'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/ikeda-and-northern-osaka/', sourceLabel: 'Japan National Tourism Organization northern Osaka guide' }),
  osaka({ slug: 'minoh-park', name: 'Minoh Park', description: 'A wooded riverside walk leading toward Minoh Falls.', neighbourhood: 'Minoh', coordinates: [34.8533, 135.4703], categories: ['nature', 'walk'], experienceTags: ['nature', 'hiking', 'photography'], estimatedVisitMinutes: 240, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 0, sourceUrl: 'https://www.japan.travel/en/destinations/kansai/osaka/ikeda-and-northern-osaka/', sourceLabel: 'Japan National Tourism Organization northern Osaka guide' }),
  osaka({ slug: 'teamlab-botanical', name: 'teamLab Botanical Garden Osaka', description: 'A night-time digital art experience inside Nagai Botanical Garden.', neighbourhood: 'Nagai', coordinates: [34.6101, 135.5196], categories: ['art', 'evening', 'garden'], experienceTags: ['nature', 'nightlife', 'photography'], estimatedVisitMinutes: 120, indoorOutdoor: 'outdoor', reservationStatus: 'required', priceLevel: 2, openingHours: hours('18:30', '21:30', 'low'), bestTimeWindows: [{ start: '18:30', end: '21:30' }], sourceUrl: `${OSAKA_INFO}` }),
  osaka({ slug: 'nara-park', name: 'Nara Park', city: 'Nara', description: 'Historic parkland linking central Nara’s temples and cultural sites.', neighbourhood: 'Central Nara', coordinates: [34.685, 135.843], categories: ['day-trip', 'park', 'essential'], experienceTags: ['nature', 'wildlife', 'history'], estimatedVisitMinutes: 150, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 0, sourceUrl: 'https://www.japan.travel/en/destinations/kansai/nara/', sourceLabel: 'Japan National Tourism Organization Nara guide' }),
  osaka({ slug: 'todai-ji', name: 'Todai-ji Temple', city: 'Nara', description: 'A landmark Buddhist temple complex beside Nara Park.', neighbourhood: 'Central Nara', coordinates: [34.689, 135.8398], categories: ['day-trip', 'temple', 'history'], experienceTags: ['temples', 'history', 'architecture'], estimatedVisitMinutes: 120, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('07:30', '17:30', 'low'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/nara/', sourceLabel: 'Japan National Tourism Organization Nara guide' }),
  osaka({ slug: 'fushimi-inari', name: 'Fushimi Inari Taisha', city: 'Kyoto', description: 'A hillside shrine route through thousands of torii gates.', neighbourhood: 'Fushimi', coordinates: [34.9671, 135.7727], categories: ['day-trip', 'shrine', 'essential'], experienceTags: ['temples', 'hiking', 'photography'], estimatedVisitMinutes: 180, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 0, sourceUrl: 'https://www.japan.travel/en/destinations/kansai/kyoto/', sourceLabel: 'Japan National Tourism Organization Kyoto guide' }),
  osaka({ slug: 'kiyomizu-dera', name: 'Kiyomizu-dera Temple', city: 'Kyoto', description: 'A historic temple and hillside district with wide views across Kyoto.', neighbourhood: 'Higashiyama', coordinates: [34.9949, 135.785], categories: ['day-trip', 'temple', 'essential'], experienceTags: ['temples', 'history', 'photography'], estimatedVisitMinutes: 150, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 1, openingHours: hours('06:00', '18:00', 'low'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/kyoto/', sourceLabel: 'Japan National Tourism Organization Kyoto guide' }),
  osaka({ slug: 'kobe-harborland', name: 'Kobe Harborland', city: 'Kobe', description: 'A waterfront district combining harbour walks, shopping and evening views.', neighbourhood: 'Kobe Waterfront', coordinates: [34.6806, 135.1867], categories: ['day-trip', 'waterfront', 'evening'], experienceTags: ['shopping', 'photography', 'nightlife'], estimatedVisitMinutes: 180, indoorOutdoor: 'mixed', reservationStatus: 'not-needed', priceLevel: 2, sourceUrl: 'https://www.japan.travel/en/destinations/kansai/hyogo/kobe-and-around/', sourceLabel: 'Japan National Tourism Organization Kobe guide' }),
  osaka({ slug: 'nunobiki-herb-gardens', name: 'Kobe Nunobiki Herb Gardens', city: 'Kobe', description: 'A hillside garden reached by ropeway with views over Kobe.', neighbourhood: 'Shin-Kobe', coordinates: [34.7189, 135.19], categories: ['day-trip', 'garden', 'view'], experienceTags: ['nature', 'photography', 'slow-living'], estimatedVisitMinutes: 180, indoorOutdoor: 'outdoor', reservationStatus: 'not-needed', priceLevel: 2, openingHours: hours('09:30', '17:00', 'low'), sourceUrl: 'https://www.japan.travel/en/destinations/kansai/hyogo/kobe-and-around/', sourceLabel: 'Japan National Tourism Organization Kobe guide' }),
];

export const OSAKA_KNOWLEDGE_FIXTURE: DestinationKnowledgePack = {
  countryCode: 'JP',
  city: 'Osaka',
  region: 'Kansai',
  discoveryQueries: [
    { query: 'Osaka essential attractions', categories: ['essential'] },
    { query: 'Osaka food markets and districts', categories: ['food', 'market'] },
    { query: 'Osaka history museums temples', categories: ['history', 'museum', 'temple'] },
    { query: 'Osaka evening neighbourhoods', categories: ['evening', 'local-character'] },
  ],
  signatureCategories: ['food-district', 'local-character', 'history', 'waterfront'],
  neighbourhoods: [
    { id: 'minami', label: 'Minami', themes: ['food', 'nightlife', 'shopping'], centre: [34.6687, 135.5013] },
    { id: 'castle', label: 'Osaka Castle', themes: ['history', 'culture', 'parks'], centre: [34.6873, 135.5262] },
    { id: 'kita', label: 'Umeda and Nakanoshima', themes: ['modern-city', 'art', 'views'], centre: [34.699, 135.495] },
    { id: 'bay', label: 'Osaka Bay', themes: ['waterfront', 'family', 'entertainment'], centre: [34.655, 135.43] },
    { id: 'tennoji', label: 'Tennoji and Shinsekai', themes: ['heritage', 'retro', 'views'], centre: [34.651, 135.511] },
  ],
  nearbyDestinations: [
    { city: 'Nara', countryCode: 'JP', themes: ['heritage', 'nature'], minimumRecommendedDays: 5 },
    { city: 'Kyoto', countryCode: 'JP', themes: ['temples', 'history'], minimumRecommendedDays: 7 },
    { city: 'Kobe', countryCode: 'JP', themes: ['waterfront', 'nature'], minimumRecommendedDays: 8 },
  ],
  officialSources: [
    { label: 'OSAKA-INFO official tourism guide', url: OSAKA_INFO, retrievedAt: VERIFIED_AT },
    { label: 'Japan National Tourism Organization Osaka guide', url: JNTO_OSAKA, retrievedAt: VERIFIED_AT },
  ],
};

const destinationFixture = (
  city: string,
  countryCode: string,
  sourceLabel: string,
  sourceUrl: string,
  places: Array<{
    slug: string;
    name: string;
    description: string;
    neighbourhood: string;
    coordinates: [number, number];
    categories: string[];
    tags: string[];
    minutes: number;
    indoorOutdoor: PlaceCandidate['indoorOutdoor'];
    reservationStatus?: PlaceCandidate['reservationStatus'];
    priceLevel?: number;
    openingHours?: DateAwareOpeningHours;
  }>,
): PlaceCandidate[] => places.map((place) => ({
  id: `${city.toLowerCase()}-${place.slug}`,
  provider: 'official-tourism',
  providerPlaceId: `official-tourism:${city.toLowerCase()}:${place.slug}`,
  name: place.name,
  description: place.description,
  countryCode,
  city,
  neighbourhood: place.neighbourhood,
  coordinates: place.coordinates,
  categories: place.categories,
  experienceTags: place.tags,
  priceLevel: place.priceLevel,
  openingHours: place.openingHours,
  estimatedVisitMinutes: place.minutes,
  indoorOutdoor: place.indoorOutdoor,
  reservationStatus: place.reservationStatus || 'not-needed',
  sourceConfidence: place.openingHours ? 'medium' : 'high',
  sourceReferences: [{ label: sourceLabel, url: sourceUrl, retrievedAt: VERIFIED_AT }],
  lastVerifiedAt: VERIFIED_AT,
}));

export const SEOUL_PLACE_FIXTURE = destinationFixture(
  'Seoul',
  'KR',
  'Visit Seoul official tourism guide',
  'https://english.visitseoul.net/',
  [
    { slug: 'gyeongbokgung', name: 'Gyeongbokgung Palace', description: 'Joseon-era palace complex at the heart of historic Seoul.', neighbourhood: 'Jongno', coordinates: [37.5796, 126.977], categories: ['essential', 'history'], tags: ['history', 'architecture'], minutes: 150, indoorOutdoor: 'mixed', priceLevel: 1, openingHours: hours('09:00', '18:00', 'low') },
    { slug: 'bukchon', name: 'Bukchon Hanok Village', description: 'Historic hillside lanes lined with traditional hanok houses.', neighbourhood: 'Jongno', coordinates: [37.5826, 126.983], categories: ['local-character', 'walk'], tags: ['architecture', 'photography'], minutes: 120, indoorOutdoor: 'outdoor', priceLevel: 0 },
    { slug: 'changdeokgung', name: 'Changdeokgung Palace', description: 'UNESCO-listed palace and garden complex in Jongno.', neighbourhood: 'Jongno', coordinates: [37.5794, 126.991], categories: ['history', 'garden'], tags: ['history', 'nature'], minutes: 150, indoorOutdoor: 'mixed', priceLevel: 1, openingHours: hours('09:00', '18:00', 'low') },
    { slug: 'gwangjang', name: 'Gwangjang Market', description: 'Long-running covered market known for Korean food stalls.', neighbourhood: 'Jongno', coordinates: [37.57, 126.9996], categories: ['market', 'food'], tags: ['street-food', 'local-character'], minutes: 120, indoorOutdoor: 'mixed', priceLevel: 1 },
    { slug: 'ddp', name: 'Dongdaemun Design Plaza', description: 'Contemporary cultural and design landmark in Dongdaemun.', neighbourhood: 'Dongdaemun', coordinates: [37.5665, 127.0092], categories: ['architecture', 'art'], tags: ['architecture', 'nightlife'], minutes: 120, indoorOutdoor: 'mixed', priceLevel: 1 },
    { slug: 'n-seoul-tower', name: 'N Seoul Tower', description: 'City observatory on Namsan with broad evening views.', neighbourhood: 'Namsan', coordinates: [37.5512, 126.9882], categories: ['view', 'evening'], tags: ['photography', 'nightlife'], minutes: 120, indoorOutdoor: 'mixed', reservationStatus: 'recommended', priceLevel: 2 },
    { slug: 'leeum', name: 'Leeum Museum of Art', description: 'Museum pairing historic Korean art with contemporary work.', neighbourhood: 'Hannam', coordinates: [37.5384, 126.9994], categories: ['museum', 'art'], tags: ['museums', 'architecture'], minutes: 150, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 2, openingHours: hours('10:00', '18:00', 'low') },
    { slug: 'cheonggyecheon', name: 'Cheonggyecheon Stream', description: 'Restored urban stream and pedestrian route through central Seoul.', neighbourhood: 'Central Seoul', coordinates: [37.57, 127.005], categories: ['walk', 'local-character'], tags: ['nature', 'photography'], minutes: 90, indoorOutdoor: 'outdoor', priceLevel: 0 },
  ],
);

export const ROME_PLACE_FIXTURE = destinationFixture(
  'Rome',
  'IT',
  'Turismo Roma official tourism guide',
  'https://www.turismoroma.it/en',
  [
    { slug: 'colosseum', name: 'Colosseum', description: 'Ancient amphitheatre and defining landmark of imperial Rome.', neighbourhood: 'Centro Storico', coordinates: [41.8902, 12.4922], categories: ['essential', 'history'], tags: ['history', 'architecture'], minutes: 150, indoorOutdoor: 'mixed', reservationStatus: 'required', priceLevel: 2, openingHours: hours('08:30', '19:00', 'low') },
    { slug: 'roman-forum', name: 'Roman Forum', description: 'Archaeological landscape of temples and civic ruins beside the Palatine.', neighbourhood: 'Centro Storico', coordinates: [41.8925, 12.4853], categories: ['history', 'essential'], tags: ['history', 'walking'], minutes: 150, indoorOutdoor: 'outdoor', reservationStatus: 'required', priceLevel: 2, openingHours: hours('08:30', '19:00', 'low') },
    { slug: 'pantheon', name: 'Pantheon', description: 'Exceptionally preserved ancient Roman monument in the historic centre.', neighbourhood: 'Centro Storico', coordinates: [41.8986, 12.4769], categories: ['history', 'architecture'], tags: ['history', 'architecture'], minutes: 75, indoorOutdoor: 'indoor', reservationStatus: 'recommended', priceLevel: 1 },
    { slug: 'trevi-fountain', name: 'Trevi Fountain', description: 'Monumental Baroque fountain in central Rome.', neighbourhood: 'Centro Storico', coordinates: [41.9009, 12.4833], categories: ['essential', 'local-character'], tags: ['architecture', 'photography'], minutes: 60, indoorOutdoor: 'outdoor', priceLevel: 0 },
    { slug: 'vatican-museums', name: 'Vatican Museums', description: 'Major museum complex housing papal collections and the Sistine Chapel.', neighbourhood: 'Vatican', coordinates: [41.9065, 12.4536], categories: ['museum', 'essential'], tags: ['museums', 'history'], minutes: 240, indoorOutdoor: 'indoor', reservationStatus: 'required', priceLevel: 3, openingHours: hours('08:00', '20:00', 'low') },
    { slug: 'st-peters', name: 'St. Peter’s Basilica', description: 'Renaissance basilica and major pilgrimage site in Vatican City.', neighbourhood: 'Vatican', coordinates: [41.9022, 12.4539], categories: ['history', 'architecture'], tags: ['architecture', 'history'], minutes: 150, indoorOutdoor: 'mixed', reservationStatus: 'recommended', priceLevel: 0 },
    { slug: 'borghese-gallery', name: 'Galleria Borghese', description: 'Reservation-led art museum inside Villa Borghese gardens.', neighbourhood: 'Villa Borghese', coordinates: [41.9142, 12.4922], categories: ['museum', 'art'], tags: ['museums', 'nature'], minutes: 120, indoorOutdoor: 'indoor', reservationStatus: 'required', priceLevel: 3, openingHours: hours('09:00', '19:00', 'low') },
    { slug: 'trastevere', name: 'Trastevere', description: 'Historic neighbourhood of lanes, squares and evening restaurants.', neighbourhood: 'Trastevere', coordinates: [41.8897, 12.4708], categories: ['local-character', 'evening'], tags: ['food', 'nightlife', 'walking'], minutes: 150, indoorOutdoor: 'outdoor', priceLevel: 2 },
  ],
);

export const ALL_DESTINATION_FIXTURES = [
  ...OSAKA_PLACE_FIXTURE,
  ...SEOUL_PLACE_FIXTURE,
  ...ROME_PLACE_FIXTURE,
];

export class FixturePlaceDiscoveryProvider implements PlaceDiscoveryProvider {
  readonly mode = 'fixture' as const;

  async search(request: DiscoveryRequest): Promise<PlaceCandidate[]> {
    const city = request.city.trim().toLowerCase();
    const candidates = ALL_DESTINATION_FIXTURES.filter((candidate) => candidate.city.toLowerCase() === city);
    const limit = Math.max(1, request.limit || candidates.length);
    return candidates.slice(0, limit).map((candidate) => structuredClone(candidate));
  }

  async details(providerPlaceId: string): Promise<PlaceCandidateDetails> {
    const candidate = ALL_DESTINATION_FIXTURES.find((item) => item.providerPlaceId === providerPlaceId);
    if (!candidate) throw new Error(`Fixture place ${providerPlaceId} was not found.`);
    return structuredClone(candidate);
  }
}
