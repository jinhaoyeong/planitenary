export type ActivityType = 'food' | 'sight' | 'culture' | 'walk' | 'nature' | 'travel' | 'flight' | 'cafe' | 'shop' | 'nightlife' | 'other';

export interface Activity {
  time: string;
  name: string;
  description: string;
  type: ActivityType;
  location?: string;
  cost?: string; // Estimate in RMB
  rating?: number;
  coordinates?: [number, number]; // [lat, lng] for manual location search
  moodVotes?: {
    self?: 'see_first' | 'must_go' | 'maybe' | 'skip' | 'love' | 'funny' | 'surprised' | 'pray';
    partner?: 'see_first' | 'must_go' | 'maybe' | 'skip' | 'love' | 'funny' | 'surprised' | 'pray';
    comment?: string;
    commentBy?: 'self' | 'partner';
  };
  voiceNote?: {
    dataUrl: string;
    durationSec: number;
    createdAt: string;
  };
}

export interface DayPhoto {
  id: string;
  dataUrl: string; // Compressed base64 image
  caption?: string;
  createdAt: string;
}

export interface DayPlan {
  day: number;
  date: string;
  city: string;
  title: string;
  activities: Activity[];
  photos?: DayPhoto[];
}

export interface Itinerary {
  id: string;
  name: string;
  cities: string[];
  description: string;
  /** Labels shown in the scrolling navigation strip on the home view. */
  marqueeItems?: string[];
  heroEyebrow?: string;
  primaryButtonLabel?: string;
  primaryButtonTab?: 'itinerary' | 'maps' | 'draft' | 'budget' | 'checklist' | 'documents' | 'photos' | 'profile';
  secondaryButtonLabel?: string;
  secondaryButtonTab?: 'itinerary' | 'maps' | 'draft' | 'budget' | 'checklist' | 'documents' | 'photos' | 'profile';
  coverHeadline?: string;
  coverLabel?: string;
  coverYear?: string;
  heroDayBadge?: string;
  days: DayPlan[];
}

export const itineraries: Itinerary[] = [
  {
    id: 'gz-sz',
    name: 'Lingnan Modern & History',
    cities: ['Guangzhou', 'Shenzhen'],
    description: 'A journey through the heart of Cantonese culture, from the historical streets of Guangzhou to the futuristic skyline of Shenzhen. Perfect for foodies and urban explorers.',
    days: [
      {
        day: 1,
        date: 'Apr 23',
        city: 'Guangzhou',
        title: 'Arrival & Cantonese Flavors',
        activities: [
          { time: '14:00', name: 'Arrival at CAN', description: 'Land at Guangzhou Baiyun International Airport. Take Metro Line 3 to city center (approx. 45 mins).', type: 'travel', cost: 'Metro: 8 RMB' },
          { time: '16:00', name: 'Check-in', description: 'Stay near Beijing Road or Tiyu Xilu for best access to metro and food.', type: 'travel' },
          { time: '18:00', name: 'Beijing Road Pedestrian Street', description: 'Walk through the bustling commercial street with ancient road ruins preserved under glass. Visit the Dafo Temple nearby.', type: 'walk', location: 'Beijing Road' },
          { time: '20:00', name: 'Dim Sum Dinner', description: 'Try "Dian Dou De" or "Tao Tao Ju" for authentic night tea/dim sum. Must-try: Shrimp dumplings, Red rice rolls.', type: 'food', cost: '150 RMB' }
        ]
      },
      {
        day: 2,
        date: 'Apr 24',
        city: 'Guangzhou',
        title: 'Old Canton Vibes',
        activities: [
          { time: '09:00', name: 'Shamian Island', description: 'Explore the colonial architecture and banyan tree-lined streets of this former concession area.', type: 'sight', location: 'Shamian North St' },
          { time: '12:00', name: 'Lunch: Roast Goose', description: 'Try "Bing Sheng" or a local roast meat shop for famous Canton Roast Goose.', type: 'food', cost: '120 RMB' },
          { time: '14:00', name: 'Chen Clan Ancestral Hall', description: 'Admire the exquisite wood, stone, and brick carvings. A folk art masterpiece.', type: 'culture', cost: '10 RMB' },
          { time: '16:30', name: 'Yong Qing Fang', description: 'Revitalized historic district with Bruce Lee\'s ancestral home and Cantonese Opera Museum.', type: 'culture', location: 'Enning Road' },
          { time: '19:30', name: 'Pearl River Night Cruise', description: 'See the stunning city lights and Canton Tower from the river.', type: 'sight', cost: '80 RMB' }
        ]
      },
      {
        day: 3,
        date: 'Apr 25',
        city: 'Guangzhou',
        title: 'Parks & Towers',
        activities: [
          { time: '09:00', name: 'Yuexiu Park', description: 'Visit the Five Rams Statue and the ancient Zhenhai Tower (Guangzhou Museum).', type: 'nature', cost: 'Free' },
          { time: '14:00', name: 'Dongshankou', description: 'Hip area with red brick villas turned into trendy cafes, galleries, and vintage shops.', type: 'walk', location: 'Dongshankou' },
          { time: '19:00', name: 'Huacheng Square', description: 'Best view of Canton Tower (Slim Waist) and skyscrapers. Great for photos of the modern CBD.', type: 'sight', location: 'Zhujiang New Town' }
        ]
      },
      {
        day: 4,
        date: 'Apr 26',
        city: 'Guangzhou',
        title: 'History Deep Dive',
        activities: [
          { time: '09:30', name: 'Nanyue King Museum', description: 'Explore the 2000-year-old tomb and artifacts from the Nanyue Kingdom.', type: 'culture', cost: '10 RMB' },
          { time: '14:00', name: 'Sacred Heart Cathedral', description: 'Gothic granite cathedral, one of the few of its kind in the world.', type: 'sight', location: 'Yide Road' },
          { time: '18:00', name: 'Claypot Rice', description: 'Dinner at a local shop in the old district (e.g., Min Ji).', type: 'food', cost: '50 RMB' }
        ]
      },
      {
        day: 5,
        date: 'Apr 27',
        city: 'Guangzhou',
        title: 'Xiguan Heritage',
        activities: [
          { time: '08:30', name: 'Morning Tea (Yum Cha)', description: 'Experience the noisy, lively atmosphere at Guangzhou Restaurant or Panxi Restaurant.', type: 'food', cost: '120 RMB' },
          { time: '11:00', name: 'Liwan Lake Park', description: 'Relax by the lake and see traditional Xiguan mansions.', type: 'nature' },
          { time: '15:00', name: 'Shopping at Teemall/Parc Central', description: 'Modern shopping experience in Tianhe district.', type: 'walk' }
        ]
      },
      {
        day: 6,
        date: 'Apr 28',
        city: 'Shenzhen',
        title: 'To the Tech Hub',
        activities: [
          { time: '10:00', name: 'Train to Shenzhen', description: 'High-speed rail from Guangzhou South to Shenzhen North/Futian (approx 30-40 mins).', type: 'travel', cost: '74.5 RMB' },
          { time: '14:00', name: 'Lianhuashan Park', description: 'Hike up for a panoramic view of the CBD and pay respects to the Deng Xiaoping statue.', type: 'nature' },
          { time: '19:30', name: 'Civic Center Light Show', description: 'Spectacular LED show on the buildings (Fri/Sat/Holidays).', type: 'sight', location: 'Civic Center' }
        ]
      },
      {
        day: 7,
        date: 'Apr 29',
        city: 'Shenzhen',
        title: 'Coastal Modernity',
        activities: [
          { time: '09:00', name: 'Shenzhen Bay Park', description: 'Walk along the promenade seeing Hong Kong across the water.', type: 'nature' },
          { time: '14:00', name: 'Sea World', description: 'Entertainment district built around the Minghua ship. Great for lunch.', type: 'sight', location: 'Shekou' },
          { time: '18:00', name: 'Talent Park', description: 'Beautiful park with skyline reflections, perfect for evening strolls.', type: 'walk', location: 'Nanshan' }
        ]
      },
      {
        day: 8,
        date: 'Apr 30',
        city: 'Shenzhen',
        title: 'Art & Culture',
        activities: [
          { time: '10:00', name: 'Dafen Oil Painting Village', description: 'See where thousands of replica paintings are made and buy some art.', type: 'culture', location: 'Buji' },
          { time: '15:00', name: 'Nantou Ancient City', description: 'The historic origin of Shenzhen, now a trendy cultural spot with cafes and exhibitions.', type: 'culture', location: 'Nanshan' },
          { time: '19:00', name: 'OCT Harbour', description: 'Modern entertainment complex with water shows and dining.', type: 'sight', location: 'OCT' }
        ]
      },
      {
        day: 9,
        date: 'May 1',
        city: 'Shenzhen',
        title: 'Electronics & Shopping',
        activities: [
          { time: '10:00', name: 'Huaqiangbei', description: 'The world\'s largest electronics market. Tech heaven for gadget lovers.', type: 'sight', location: 'Huaqiangbei' },
          { time: '14:00', name: 'MixC World', description: 'High-end shopping and trendy vibes with art installations.', type: 'walk', location: 'Hi-Tech Park' },
          { time: '18:00', name: 'Coconut Chicken Hotpot', description: 'A Shenzhen specialty (mild & sweet). Try "Run Yuan".', type: 'food', cost: '150 RMB' }
        ]
      },
      {
        day: 10,
        date: 'May 2',
        city: 'Shenzhen',
        title: 'Theme Parks or Chill',
        activities: [
          { time: '10:00', name: 'Window of the World', description: 'Famous theme park with miniature replicas of world wonders. (Alternative: Happy Valley).', type: 'sight', cost: '220 RMB' },
          { time: '16:00', name: 'O·POWER Culture & Art Center', description: 'Converted power plant into a blue-themed art park.', type: 'sight' },
          { time: '19:00', name: 'Farewell Dinner', description: 'Enjoy a nice meal at a rooftop bar in Coco Park.', type: 'food', cost: '300 RMB' }
        ]
      },
      {
        day: 11,
        date: 'May 3',
        city: 'Shenzhen',
        title: 'Departure',
        activities: [
          { time: '09:00', name: 'Airport Transfer', description: 'Metro Line 11 to SZX Airport.', type: 'travel' },
          { time: '12:00', name: 'Fly Home', description: 'Departure to Kuala Lumpur.', type: 'travel' }
        ]
      }
    ]
  },
  {
    id: 'cq-cd',
    name: 'Spicy Cyberpunk & Pandas',
    cities: ['Chongqing', 'Chengdu'],
    description: 'Experience the 8D magic of Chongqing and the laid-back teahouse culture of Chengdu. Famous for hotpot, pandas, and stunning landscapes.',
    days: [
      {
        day: 1,
        date: 'Apr 23',
        city: 'Chongqing',
        title: 'Arrival in the Mountain City',
        activities: [
          { time: '14:00', name: 'Arrival at CKG', description: 'Land at Chongqing Jiangbei Airport. Metro Line 10/3 to city.', type: 'travel', cost: 'Metro: 6 RMB' },
          { time: '16:00', name: 'Check-in', description: 'Stay near Jiefangbei for central access to major sights.', type: 'travel' },
          { time: '19:00', name: 'Hongya Cave', description: 'Stunning stilt house complex lit up at night. Best viewed from Qiansimen Bridge or across the river.', type: 'sight', location: 'Cangbai Road' },
          { time: '20:30', name: 'Chongqing Hotpot', description: 'Must-try spicy numbing hotpot. Try "Peijie" or "Zhou Shixiong".', type: 'food', cost: '150 RMB' }
        ]
      },
      {
        day: 2,
        date: 'Apr 24',
        city: 'Chongqing',
        title: '8D City Experience',
        activities: [
          { time: '09:00', name: 'Liziba Station', description: 'Watch the monorail pass through a residential building. A viral sensation.', type: 'sight', location: 'Liziba' },
          { time: '11:00', name: 'Eling Park (Testbed 2)', description: 'Panoramic views of the city and industrial chic art district.', type: 'sight' },
          { time: '15:00', name: 'Kuixing Building', description: 'Experience the "1st floor is 22nd floor" confusion.', type: 'walk' },
          { time: '19:00', name: 'Raffles City', description: 'Futuristic complex at the confluence of two rivers. Visit "The Crystal" skybridge.', type: 'sight', location: 'Chaotianmen' }
        ]
      },
      {
        day: 3,
        date: 'Apr 25',
        city: 'Chongqing',
        title: 'Old & New',
        activities: [
          { time: '09:00', name: 'Ciqikou Ancient Town', description: 'Historic port town. Try Mahua (twisted dough twists) and see the tea houses.', type: 'culture', location: 'Shapingba' },
          { time: '14:00', name: 'White Elephant Street', description: 'Colonial style buildings and history of opening as a port.', type: 'walk' },
          { time: '19:00', name: 'Yangtze River Cableway', description: 'Ride across the river for night views. Book on WeChat in advance to avoid queues.', type: 'sight', cost: '20 RMB' }
        ]
      },
      {
        day: 4,
        date: 'Apr 26',
        city: 'Chongqing',
        title: 'Hidden Gems',
        activities: [
          { time: '09:30', name: 'Graffiti Street', description: 'Sichuan Fine Arts Institute area covered in colorful street art.', type: 'culture', location: 'Huangjueping' },
          { time: '12:00', name: 'Transportation Tea House', description: 'Old school teahouse frozen in time. Authentic local vibe.', type: 'culture', cost: '10 RMB' },
          { time: '16:00', name: 'Shibati (18 Steps)', description: 'Reconstructed traditional steps connecting upper and lower city.', type: 'walk' },
          { time: '19:00', name: 'Nanshan Hotpot', description: 'Huge hotpot park on the mountain (Pipa Yuan). Guinness record holder.', type: 'food', cost: '200 RMB' }
        ]
      },
      {
        day: 5,
        date: 'Apr 27',
        city: 'Chongqing',
        title: 'History & Farewell CQ',
        activities: [
          { time: '09:00', name: 'Huguang Guild Hall', description: 'Yellow ancient buildings complex, showcasing immigration history.', type: 'culture', cost: '30 RMB' },
          { time: '13:00', name: 'Longmenhao Old Street', description: 'Brick buildings with river views, great for afternoon tea.', type: 'walk' },
          { time: '18:00', name: 'Jiefangbei', description: 'Shopping and street food at the liberation monument.', type: 'walk' }
        ]
      },
      {
        day: 6,
        date: 'Apr 28',
        city: 'Chengdu',
        title: 'To the Land of Abundance',
        activities: [
          { time: '10:00', name: 'Train to Chengdu', description: 'High-speed rail to Chengdu East (1.5-2 hrs).', type: 'travel', cost: '154 RMB' },
          { time: '14:00', name: 'Check-in', description: 'Stay near Chunxi Road or Taikoo Li.', type: 'travel' },
          { time: '16:00', name: 'Taikoo Li & IFS', description: 'See the climbing Panda sculpture and luxury shopping district built around an ancient temple.', type: 'sight' }
        ]
      },
      {
        day: 7,
        date: 'Apr 29',
        city: 'Chengdu',
        title: 'Panda Day',
        activities: [
          { time: '07:30', name: 'Panda Base', description: 'Go very early (opening 7:30) to see active pandas and the baby nursery. Visit Hua Hua if lucky!', type: 'nature', cost: '55 RMB' },
          { time: '14:00', name: 'Wenshu Monastery', description: 'Best preserved Buddhist temple in Chengdu. Peaceful vibe.', type: 'culture', cost: 'Free' },
          { time: '18:00', name: 'Hotpot or Chuanchuan', description: 'Try "Xiaolongkan" or local skewers.', type: 'food', cost: '150 RMB' }
        ]
      },
      {
        day: 8,
        date: 'Apr 30',
        city: 'Chengdu',
        title: 'Cultural Immersion',
        activities: [
          { time: '09:00', name: 'Du Fu Thatched Cottage', description: 'Home of the famous Tang dynasty poet. Beautiful gardens.', type: 'culture', cost: '50 RMB' },
          { time: '13:00', name: 'Wu Hou Shrine', description: 'Memorial to Three Kingdoms heroes (Liu Bei, Zhuge Liang).', type: 'culture', cost: '50 RMB' },
          { time: '15:00', name: 'Jinli Ancient Street', description: 'Snacking street right next to the shrine. Try "San Da Pao".', type: 'food' },
          { time: '20:00', name: 'Sichuan Opera', description: 'Watch the face-changing performance at Shufeng Yayun.', type: 'culture', cost: '200 RMB' }
        ]
      },
      {
        day: 9,
        date: 'May 1',
        city: 'Chengdu',
        title: 'Chill Vibes',
        activities: [
          { time: '09:30', name: 'People\'s Park', description: 'Drink tea at Heming Teahouse and try ear cleaning. Watch locals match.', type: 'culture', cost: '30 RMB' },
          { time: '14:00', name: 'Kuanzhai Alley', description: 'Wide and Narrow Alleys. Touristy but well preserved Qing architecture.', type: 'walk' },
          { time: '18:00', name: 'Yulin Road', description: 'Experience local nightlife and bistro vibes. Made famous by a song.', type: 'walk' }
        ]
      },
      {
        day: 10,
        date: 'May 2',
        city: 'Chengdu',
        title: 'Giant Buddha & Mystery',
        activities: [
          { time: '08:00', name: 'Train to Leshan', description: '1 hour train to Leshan.', type: 'travel', cost: '54 RMB' },
          { time: '10:00', name: 'Leshan Giant Buddha', description: 'See the massive stone Buddha carved into the cliff. Boat tour recommended for best view.', type: 'sight', cost: '80 RMB' },
          { time: '15:00', name: 'Sanxingdui Museum', description: 'Ancient Shu civilization artifacts. Bronze masks. (Requires travel north of Chengdu).', type: 'culture', cost: '72 RMB' },
          { time: '19:00', name: 'Return to Chengdu', description: 'Train back.', type: 'travel' }
        ]
      },
      {
        day: 11,
        date: 'May 3',
        city: 'Chengdu',
        title: 'Departure',
        activities: [
          { time: '09:00', name: 'Last Stroll', description: 'Walk around the hotel area or buy last souvenirs.', type: 'walk' },
          { time: '12:00', name: 'Airport Transfer', description: 'Metro Line 18 to Tianfu Airport (far!) or Line 10 to Shuangliu.', type: 'travel' },
          { time: '15:00', name: 'Fly Home', description: 'Back to KL.', type: 'travel' }
        ]
      }
    ]
  }
];

export const tips = [
  { category: 'Apps', items: ['Alipay (Link foreign card)', 'WeChat (Communication & Pay)', 'Amap (Gaode Maps) - Essential for navigation', 'Trip.com (Hotels/Trains)', 'MetroMan (Subway maps)', 'Translate App (DeepL/Baidu)'] },
  { category: 'Internet', items: ['Google/Insta/FB blocked. Buy a roaming plan from Malaysia (e.g., Celcom/Maxis) or get an eSIM (Airalo/Holafly) that bypasses GFW. VPNs are unreliable.'] },
  { category: 'Payment', items: ['Cash is rarely used. Set up Alipay TourPass or link Touch \'n Go eWallet (Alipay+ supported) before arriving. Verify identity in app.'] },
  { category: 'Transport', items: ['Didi (Ride hailing) is within Alipay.', 'High-speed trains require passport. Book on Trip.com 14 days in advance.', 'Metro is the best way to move around cities.'] },
  { category: 'Visa', items: ['Malaysians currently enjoy 15-day visa-free entry to China (extended to end of 2025/2026). Check latest embassy announcements before flying.'] }
];

export const phrases = [
  { chinese: '你好', pinyin: 'Nǐ hǎo', english: 'Hello' },
  { chinese: '谢谢', pinyin: 'Xiè xiè', english: 'Thank you' },
  { chinese: '多少钱?', pinyin: 'Duō shǎo qián?', english: 'How much?' },
  { chinese: '太贵了', pinyin: 'Tài guì le', english: 'Too expensive' },
  { chinese: '厕所在哪里?', pinyin: 'Cè suǒ zài nǎ lǐ?', english: 'Where is the toilet?' },
  { chinese: '不要辣', pinyin: 'Bù yào là', english: 'No spicy' },
  { chinese: '我要这个', pinyin: 'Wǒ yào zhè ge', english: 'I want this' },
  { chinese: '听不懂', pinyin: 'Tīng bù dǒng', english: 'I don\'t understand' }
];
