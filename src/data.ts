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
    traveler1?: 'see_first' | 'must_go' | 'maybe' | 'skip' | 'love' | 'funny' | 'surprised' | 'pray';
    traveler2?: 'see_first' | 'must_go' | 'maybe' | 'skip' | 'love' | 'funny' | 'surprised' | 'pray';
    comment?: string;
    commentBy?: 'traveler1' | 'traveler2';
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
  days: DayPlan[];
}

export const itineraries: Itinerary[] = [
  {
    id: 'starter-trip',
    name: 'New Trip',
    cities: [],
    description: 'Start with a blank travel handbook and shape every day your way.',
    days: [
      {
        day: 1,
        date: 'Add date',
        city: 'Add city',
        title: 'Plan your first day',
        activities: []
      }
    ]
  }
];

export const tips: Array<{ category: string; items: string[] }> = [];

export const phrases: Array<{ chinese: string; pinyin: string; english: string }> = [];
