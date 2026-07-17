import { useState, useMemo, useEffect } from 'react';
import type { Itinerary, Activity, ActivityType } from '../data';
import { MapPin, Utensils, Camera, Landmark, Footprints, Train, Search, Plus, Calendar, Clock, Tag, X, Save, ExternalLink } from 'lucide-react';
import { ThemedSelect } from './ui/ThemedSelect';
import { clsx } from 'clsx';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';

// Fix for default marker icons in React Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

interface MapsProps {
  itinerary: Itinerary;
  onItineraryChange?: (itinerary: Itinerary) => void;
}

interface LocationItem {
  activity: Activity;
  day: number;
  city: string;
  date: string;
  coords: [number, number];
  dayIndex: number;
  activityIndex: number;
}

const ActivityIcon = ({ type }: { type: ActivityType }) => {
  switch (type) {
    case 'food': return <Utensils className="w-3.5 h-3.5 md:w-4 md:h-4" />;
    case 'sight': return <Camera className="w-3.5 h-3.5 md:w-4 md:h-4" />;
    case 'culture': return <Landmark className="w-3.5 h-3.5 md:w-4 md:h-4" />;
    case 'walk': return <Footprints className="w-3.5 h-3.5 md:w-4 md:h-4" />;
    case 'travel': return <Train className="w-3.5 h-3.5 md:w-4 md:h-4" />;
    default: return <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4" />;
  }
};

const activityTypeLabels: Record<ActivityType, string> = {
  food: 'Restaurants',
  sight: 'Attractions',
  culture: 'Cultural Sites',
  walk: 'Walking Areas',
  nature: 'Nature & Parks',
  travel: 'Transport',
  flight: 'Flights',
  cafe: 'Cafes',
  shop: 'Shopping',
  nightlife: 'Nightlife',
  other: 'Other'
};

// Coordinate mapping for known locations
const locationCoordinates: Record<string, [number, number]> = {
  // Guangzhou
  'Arrival at CAN': [23.3924, 113.2988],
  'Beijing Road Pedestrian Street': [23.1252, 113.2644],
  'Shamian Island': [23.1075, 113.2425],
  'Chen Clan Ancestral Hall': [23.1319, 113.2478],
  'Yuexiu Park': [23.1417, 113.2644],
  'Dongshankou': [23.1233, 113.2889],
  'Huacheng Square': [23.1189, 113.3197],
  'Nanyue King Museum': [23.1394, 113.2561],
  'Sacred Heart Cathedral': [23.1165, 113.2561],
  'Yong Qing Fang': [23.1150, 113.2389],
  'Liwan Lake Park': [23.1217, 113.2333],
  'Dim Sum Dinner': [23.1200, 113.2500], // Approx near Shangxiajiu
  'Lunch: Roast Goose': [23.1250, 113.2600],
  'Claypot Rice': [23.1150, 113.2550],
  'Pearl River Night Cruise': [23.1100, 113.2800],
  
  // Shenzhen
  'Lianhuashan Park': [22.5539, 114.0579],
  'Shenzhen Bay Park': [22.5200, 113.9458],
  'Sea World': [22.4828, 113.9161],
  'Talent Park': [22.5161, 113.9458],
  'Dafen Oil Painting Village': [22.6167, 114.1333],
  'Nantou Ancient City': [22.5333, 113.9167],
  'OCT Harbour': [22.5250, 113.9833],
  'Huaqiangbei': [22.5431, 114.0858],
  'MixC World': [22.5408, 113.9533],
  'O·POWER Culture & Art Center': [22.5333, 113.9833],
  'Civic Center Light Show': [22.5431, 114.0579],
  'Coconut Chicken Hotpot': [22.5400, 114.0500],
  
  // Chongqing
  'Arrival at CKG': [29.7192, 106.6333],
  'Hongya Cave': [29.5630, 106.5772],
  'Liziba Station': [29.5531, 106.5333],
  'Eling Park (Testbed 2)': [29.5531, 106.5333],
  'Kuixing Building': [29.5611, 106.5722],
  'Raffles City': [29.5630, 106.5861],
  'Ciqikou Ancient Town': [29.5833, 106.4500],
  'White Elephant Street': [29.5583, 106.5833],
  'Yangtze River Cableway': [29.5583, 106.5778],
  'Graffiti Street': [29.5167, 106.5167],
  'Transportation Tea House': [29.5167, 106.5167],
  'Shibati (18 Steps)': [29.5556, 106.5722],
  'Nanshan Hotpot': [29.5500, 106.6000],
  'Huguang Guild Hall': [29.5611, 106.5889],
  'Longmenhao Old Street': [29.5583, 106.5889],
  'Jiefangbei': [29.5572, 106.5772],
  'Chongqing Hotpot': [29.5572, 106.5772],
  
  // Chengdu
  'Taikoo Li & IFS': [30.6561, 104.0811],
  'Panda Base': [30.7333, 104.1461],
  'Wenshu Monastery': [30.6761, 104.0736],
  'Du Fu Thatched Cottage': [30.6611, 104.0286],
  'Wu Hou Shrine': [30.6450, 104.0450],
  'Jinli Ancient Street': [30.6450, 104.0450],
  'People\'s Park': [30.6583, 104.0556],
  'Kuanzhai Alley': [30.6633, 104.0533],
  'Yulin Road': [30.6333, 104.0667],
  'Leshan Giant Buddha': [29.5461, 103.7681],
  'Sichuan Opera': [30.6600, 104.0600],
  'Hotpot or Chuanchuan': [30.6500, 104.0800],
};

const cityCenters: Record<string, [number, number]> = {
  'Guangzhou': [23.1291, 113.2644],
  'Shenzhen': [22.5431, 114.0579],
  'Chongqing': [29.5630, 106.5516],
  'Chengdu': [30.5728, 104.0668],
};

// Component to recenter map when locations change
const MapUpdater = ({ center }: { center: [number, number] }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, 13);
  }, [center, map]);
  return null;
};

export const Maps = ({ itinerary, onItineraryChange }: MapsProps) => {
  const [selectedCity, setSelectedCity] = useState<string>('All Cities');
  const [selectedType, setSelectedType] = useState<string>('All Locations');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [editLocationQuery, setEditLocationQuery] = useState('');
  const [editLocationResults, setEditLocationResults] = useState<any[]>([]);
  const [isEditSearching, setIsEditSearching] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationItem | null>(null);
  
  // Form state for adding activity
  const [newActivity, setNewActivity] = useState<Partial<Activity>>({
    type: 'sight',
    time: '10:00',
    description: '',
    cost: ''
  });
  const [selectedDay, setSelectedDay] = useState<number>(1);
  const [editActivity, setEditActivity] = useState<Partial<Activity>>({
    type: 'sight',
    time: '10:00',
    description: '',
    cost: ''
  });

  const normalizeTimeInput = (time?: string) => {
    if (!time) return '';
    const value = time.trim();
    const fullMatch = value.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
    if (fullMatch) {
      const rawHour = Number(fullMatch[1]);
      const minutes = fullMatch[2];
      const period = fullMatch[3].toUpperCase();
      if (Number.isNaN(rawHour) || rawHour < 1 || rawHour > 12) return '';
      let hour24 = rawHour % 12;
      if (period === 'PM') hour24 += 12;
      return `${String(hour24).padStart(2, '0')}:${minutes}`;
    }
    const simpleMatch = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!simpleMatch) return '';
    const hours = Number(simpleMatch[1]);
    const minutes = Number(simpleMatch[2]);
    if (Number.isNaN(hours) || Number.isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '';
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };

  const sortActivitiesByTime = (activities: Activity[]) => {
    return [...activities].sort((a, b) => {
      const aTime = normalizeTimeInput(a.time);
      const bTime = normalizeTimeInput(b.time);
      if (!aTime && !bTime) return 0;
      if (!aTime) return 1;
      if (!bTime) return -1;
      return aTime.localeCompare(bTime);
    });
  };

  const searchPlaces = async (query: string, limit = 5) => {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`);
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    try {
      const data = await searchPlaces(searchQuery, 5);
      setSearchResults(data);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleEditLocationSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLocationQuery.trim()) return;

    setIsEditSearching(true);
    try {
      const data = await searchPlaces(editLocationQuery, 5);
      setEditLocationResults(data);
    } catch (err) {
      console.error("Search failed", err);
    } finally {
      setIsEditSearching(false);
    }
  };

  const selectEditLocation = (place: any) => {
    setEditActivity(prev => ({
      ...prev,
      name: !prev.name || prev.name === 'New Activity' ? place.display_name.split(',')[0] : prev.name,
      location: place.display_name.split(',').slice(1, 3).join(','),
      coordinates: [parseFloat(place.lat), parseFloat(place.lon)]
    }));
    setEditLocationResults([]);
    setEditLocationQuery('');
  };

  const openAddModal = (place: any) => {
    setNewActivity({
      name: place.display_name.split(',')[0],
      location: place.display_name.split(',').slice(1, 3).join(','),
      type: 'sight',
      time: '10:00',
      description: '',
      cost: '',
      coordinates: [parseFloat(place.lat), parseFloat(place.lon)]
    });
    
    // Try to guess the day based on city if possible
    const city = place.address?.city || place.address?.town || place.address?.county || '';
    const dayMatch = itinerary.days.find(d => d.city.includes(city));
    if (dayMatch) setSelectedDay(dayMatch.day);
    
    setShowAddModal(true);
  };

  const confirmAddActivity = () => {
    if (!onItineraryChange || !newActivity.name) return;

    const activityToAdd: Activity = {
      name: newActivity.name!,
      type: newActivity.type as ActivityType || 'other',
      time: normalizeTimeInput(newActivity.time) || '10:00',
      description: newActivity.description || 'Added from Maps',
      location: newActivity.location || '',
      cost: newActivity.cost || '',
      coordinates: newActivity.coordinates
    };

    const updatedDays = itinerary.days.map(day => {
      if (day.day === selectedDay) {
        return {
          ...day,
          activities: sortActivitiesByTime([...day.activities, activityToAdd])
        };
      }
      return day;
    });

    onItineraryChange({ ...itinerary, days: updatedDays });
    setShowAddModal(false);
    setSearchQuery('');
    setSearchResults([]);
  };

  const resolveCoordinates = async (activity: Partial<Activity>) => {
    const query = [activity.name, activity.location].filter(Boolean).join(' ').trim();
    if (!query) return undefined;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`);
      const data = await response.json();
      if (Array.isArray(data) && data.length > 0) {
        return [parseFloat(data[0].lat), parseFloat(data[0].lon)] as [number, number];
      }
    } catch (err) {
      console.error("Coordinate lookup failed", err);
    }
    return undefined;
  };

  const openEditModal = (item: LocationItem) => {
    setEditingLocation(item);
    setEditActivity({
      name: item.activity.name,
      location: item.activity.location || '',
      type: item.activity.type,
      time: normalizeTimeInput(item.activity.time) || '10:00',
      description: item.activity.description || '',
      cost: item.activity.cost || '',
      coordinates: item.activity.coordinates
    });
    setEditLocationQuery('');
    setEditLocationResults([]);
    setShowEditModal(true);
  };

  const confirmEditActivity = async () => {
    if (!onItineraryChange || !editingLocation || !editActivity.name) return;
    const originalActivity = itinerary.days[editingLocation.dayIndex]?.activities[editingLocation.activityIndex];
    if (!originalActivity) return;

    const mergedActivity: Activity = {
      ...originalActivity,
      name: editActivity.name,
      location: editActivity.location || '',
      type: editActivity.type as ActivityType || originalActivity.type,
      time: normalizeTimeInput(editActivity.time) || '10:00',
      description: editActivity.description || '',
      cost: editActivity.cost || '',
      coordinates: editActivity.coordinates
    };

    const locationChanged = mergedActivity.location !== originalActivity.location || mergedActivity.name !== originalActivity.name;
    if (locationChanged) {
      const nextCoords = await resolveCoordinates(mergedActivity);
      mergedActivity.coordinates = nextCoords;
    }

    const updatedDays = itinerary.days.map((day, dayIdx) => {
      if (dayIdx !== editingLocation.dayIndex) return day;
      const updatedActivities = day.activities.map((activity, activityIdx) =>
        activityIdx === editingLocation.activityIndex ? mergedActivity : activity
      );
      return {
        ...day,
        activities: sortActivitiesByTime(updatedActivities)
      };
    });

    onItineraryChange({ ...itinerary, days: updatedDays });
    setShowEditModal(false);
    setEditingLocation(null);
  };

  // Helper to get coordinates
  const getCoordinates = (city: string, activity: Activity): [number, number] => {
    // 1. Use explicit coordinates if available
    if (activity.coordinates) return activity.coordinates;

    // 2. Check predefined location dictionary
    if (locationCoordinates[activity.name]) return locationCoordinates[activity.name];
    
    // 3. Partial match check
    const found = Object.keys(locationCoordinates).find(key => activity.name.includes(key));
    if (found) return locationCoordinates[found];

    // 4. Fallback to city center with offset
    const center = cityCenters[city] || [35.8617, 104.1954];
    // Deterministic offset based on name string length to keep markers stable but separated
    const offset = (activity.name.length % 10) * 0.002;
    return [center[0] + offset, center[1] + offset];
  };

  // Extract all locations from the itinerary
  const allLocations = useMemo(() => {
    const locations: LocationItem[] = [];
    itinerary.days.forEach((day, dayIndex) => {
      day.activities.forEach((activity, activityIndex) => {
        if (activity.location || activity.type !== 'travel') {
           locations.push({
             activity,
             day: day.day,
             city: day.city,
             date: day.date,
             coords: getCoordinates(day.city, activity),
             dayIndex,
             activityIndex
           });
        }
      });
    });
    return locations;
  }, [itinerary]);

  // Extract unique cities
  const cities = ['All Cities', ...Array.from(new Set(allLocations.map(l => l.city)))];

  // Extract unique types present in the itinerary
  const availableTypes = Array.from(new Set(allLocations.map(l => l.activity.type)));
  
  // Filter logic
  const filteredLocations = allLocations.filter(item => {
    const cityMatch = selectedCity === 'All Cities' || item.city === selectedCity;
    const typeMatch = selectedType === 'All Locations' || activityTypeLabels[item.activity.type] === selectedType;
    return cityMatch && typeMatch;
  });

  // Calculate center
  const mapCenter: [number, number] = useMemo(() => {
    if (filteredLocations.length > 0) {
      // Return the coordinates of the first filtered location
      return filteredLocations[0].coords;
    }
    // Default to first city in itinerary if no locations found
    return cityCenters[itinerary.cities[0]] || [35.8617, 104.1954];
  }, [filteredLocations, itinerary]);

  return (
    <div className="space-y-6 md:space-y-8 pb-20">
      <div className="text-center space-y-4 mb-6 md:mb-10">
        <span className="eyebrow">The map · where we'll wander</span>
        <h2
          className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight"
          style={{ color: 'var(--ink)' }}
        >
          Every pin, <span className="font-display-italic" style={{ color: 'var(--accent)' }}>plotted.</span>
        </h2>
        <p className="max-w-2xl mx-auto text-base md:text-lg leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
          Drop new places onto the map, peek at the ones already saved, or filter by city. It's all here.
        </p>
      </div>

      {/* Search Section */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 transition-colors duration-300 relative z-20">
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for places to add (e.g. 'City Museum')..."
            className="editorial-input" style={{ paddingLeft: '3rem', paddingRight: '1rem' }}
          />
          <Search className="absolute left-4 top-3.5 w-5 h-5 text-slate-400" />
          <button 
            type="submit"
            className="absolute right-2 top-2 bg-emerald-500 text-white p-1.5 rounded-xl hover:bg-emerald-600 transition-colors"
            disabled={isSearching}
          >
            {isSearching ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-lg animate-spin" /> : <Search className="w-5 h-5" />}
          </button>
        </form>

        <AnimatePresence>
          {searchResults.length > 0 && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-4 grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto pr-2"
            >
              {searchResults.map((place, i) => (
                <div key={i} className="flex gap-4 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50 hover:border-emerald-200 dark:hover:border-emerald-500/30 transition-all group">
                  <div className="flex-1 flex flex-col justify-between">
                    <div onClick={() => openAddModal(place)} className="cursor-pointer">
                      <h4 className="font-bold text-slate-900 dark:text-white line-clamp-1 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors">
                        {place.display_name.split(',')[0]}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mt-1">{place.display_name}</p>
                    </div>
                    
                    <div className="flex gap-2 mt-3">
                      <a 
                        href={`https://www.google.com/search?q=${encodeURIComponent(place.display_name)}&tbm=isch`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 flex items-center justify-center gap-2 transition-colors"
                      >
                        <Camera className="w-3.5 h-3.5" /> View Photos
                      </a>
                      <button 
                        onClick={() => openAddModal(place)}
                        className="flex-1 py-2 bg-emerald-500 text-white text-xs font-bold rounded-xl hover:bg-emerald-600 flex items-center justify-center gap-2 transition-colors shadow-sm shadow-emerald-500/20"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Filter Section */}
      <div className="bg-white dark:bg-slate-900 p-4 md:p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 space-y-5 md:space-y-6 transition-colors duration-300">
        {/* City Filter */}
        <div className="space-y-3">
          <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filter by City</label>
          <div className="flex flex-wrap gap-2">
            {cities.map(city => (
              <button
                key={city}
                onClick={() => setSelectedCity(city)}
                className={clsx(
                  "px-2.5 md:px-4 py-1 md:py-1.5 rounded-lg md:rounded-xl text-xs md:text-sm font-medium transition-all",
                  selectedCity === city
                    ? "bg-slate-900 dark:bg-emerald-600 text-white shadow-md"
                    : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                )}
              >
                {city}
              </button>
            ))}
          </div>
        </div>

        {/* Type Filter */}
        <div className="space-y-3">
          <label className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Filter by Activity Type</label>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSelectedType('All Locations')}
              className={clsx(
                "px-2.5 md:px-4 py-1 md:py-1.5 rounded-lg md:rounded-xl text-xs md:text-sm font-medium transition-all flex items-center gap-1 md:gap-1.5",
                selectedType === 'All Locations'
                  ? "bg-slate-900 dark:bg-emerald-600 text-white shadow-md"
                  : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
              )}
            >
              <MapPin className="w-3.5 h-3.5 md:w-4 md:h-4" /> All Locations
            </button>
            {availableTypes.map(type => (
              <button
                key={type}
                onClick={() => setSelectedType(activityTypeLabels[type])}
                className={clsx(
                  "px-2.5 md:px-4 py-1 md:py-1.5 rounded-lg md:rounded-xl text-xs md:text-sm font-medium transition-all flex items-center gap-1 md:gap-1.5",
                  selectedType === activityTypeLabels[type]
                    ? "bg-white dark:bg-slate-800 text-slate-800 dark:text-white border-2 border-slate-800 dark:border-emerald-500"
                    : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border-2 border-transparent"
                )}
              >
                <ActivityIcon type={type} />
                {activityTypeLabels[type]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Actual Map Area */}
      <div
        className="rounded-3xl overflow-hidden relative h-[350px] md:h-[540px] z-0"
        style={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-lift)' }}
      >
        <MapContainer 
          center={mapCenter} 
          zoom={13} 
          scrollWheelZoom={false} 
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <MapUpdater center={mapCenter} />
          
          {filteredLocations.map((item, idx) => (
            <Marker 
              key={idx} 
              position={item.coords}
            >
              <Popup>
                <div className="min-w-[200px]">
                  <h3 className="font-bold text-slate-800 text-sm mb-1">{item.activity.name}</h3>
                  <p className="text-xs text-slate-500 mb-2">{item.activity.description}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 p-1.5 rounded-xl">
                    <span className="font-medium">Day {item.day}</span>
                    <span>•</span>
                    <span>{item.city}</span>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {/* Location Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <AnimatePresence mode="popLayout">
          {filteredLocations.map((item) => (
            <motion.div
              layout
              key={`${item.day}-${item.activityIndex}-${item.activity.name}`}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-md transition-all group cursor-pointer"
              onClick={() => openEditModal(item)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-1">
                    {activityTypeLabels[item.activity.type]}
                  </span>
                  <h4 className="font-bold text-slate-800 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors line-clamp-1">
                    {item.activity.name}
                  </h4>
                </div>
                <div className={`p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 group-hover:bg-emerald-50 dark:group-hover:bg-emerald-900/30 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors`}>
                  <ActivityIcon type={item.activity.type} />
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  <MapPin className="w-4 h-4 text-slate-300 dark:text-slate-600" />
                  <span className="truncate">{item.activity.location || item.city}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 font-medium">
                  <span className="px-2 py-1 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                    Day {item.day}
                  </span>
                  <span>•</span>
                  <span>{item.city}</span>
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openEditModal(item);
                }}
                className="mt-3 w-full py-2 text-xs font-bold rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
              >
                Edit Location
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {filteredLocations.length === 0 && (
        <div className="text-center py-20 bg-slate-50 dark:bg-slate-900 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <MapPin className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-600 dark:text-slate-300">No locations found</h3>
          <p className="text-slate-400 dark:text-slate-500">Try adjusting your filters.</p>
        </div>
      )}

      {/* Add Activity Modal */}
      <AnimatePresence>
        {showEditModal && editingLocation && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowEditModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md rounded-xl shadow-2xl p-6 relative z-10 border border-slate-100 dark:border-slate-800"
            >
              <button
                onClick={() => setShowEditModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Edit Location Card</h3>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Activity Name</label>
                  <input
                    type="text"
                    value={editActivity.name}
                    onChange={(e) => setEditActivity({ ...editActivity, name: e.target.value })}
                    className="editorial-input"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Time</label>
                    <input
                      type="time"
                      value={editActivity.time}
                      onChange={(e) => setEditActivity({ ...editActivity, time: e.target.value })}
                      className="editorial-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Category</label>
                    <ThemedSelect
                      value={editActivity.type}
                      onChange={(e) => setEditActivity({ ...editActivity, type: e.target.value as ActivityType })}
                      className="editorial-select"
                    >
                      <option value="sight">Sightseeing</option>
                      <option value="food">Food & Dining</option>
                      <option value="culture">Culture & History</option>
                      <option value="shop">Shopping</option>
                      <option value="nature">Nature & Parks</option>
                      <option value="nightlife">Nightlife</option>
                      <option value="cafe">Cafe</option>
                      <option value="other">Other</option>
                    </ThemedSelect>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Location</label>
                  <form onSubmit={handleEditLocationSearch} className="relative">
                    <input
                      type="text"
                      value={editLocationQuery}
                      onChange={(e) => setEditLocationQuery(e.target.value)}
                      placeholder="Search place to autofill..."
                      className="editorial-input" style={{ paddingLeft: '2.5rem', paddingRight: '2.5rem' }}
                    />
                    <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                    <button
                      type="submit"
                      className="absolute right-2 top-2 bg-emerald-500 text-white p-1 rounded-xl hover:bg-emerald-600 transition-colors"
                      disabled={isEditSearching}
                    >
                      {isEditSearching ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-lg animate-spin" /> : <Search className="w-3 h-3" />}
                    </button>
                  </form>
                  {editLocationResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                      {editLocationResults.map((place, i) => (
                        <button
                          key={i}
                          onClick={() => selectEditLocation(place)}
                          className="w-full text-left p-3 border-b border-slate-100 dark:border-slate-700 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors"
                        >
                          <div className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">{place.display_name.split(',')[0]}</div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">{place.display_name}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <input
                    type="text"
                    value={editActivity.location}
                    onChange={(e) => setEditActivity({ ...editActivity, location: e.target.value })}
                    className="editorial-input"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Notes</label>
                  <textarea
                    value={editActivity.description}
                    onChange={(e) => setEditActivity({ ...editActivity, description: e.target.value })}
                    className="editorial-textarea" style={{ minHeight: '6rem', resize: 'none' }}
                  />
                </div>

                <button
                  onClick={confirmEditActivity}
                  className="w-full bg-slate-900 dark:bg-emerald-600 text-white font-bold py-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-slate-900/20 flex items-center justify-center gap-2 mt-4"
                >
                  <Save className="w-5 h-5" />
                  Save Changes
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => setShowAddModal(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-slate-900 w-full max-w-md rounded-xl shadow-2xl p-6 relative z-10 border border-slate-100 dark:border-slate-800"
            >
              <button 
                onClick={() => setShowAddModal(false)}
                className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>

              <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-6">Add to Itinerary</h3>
              
              <div className="space-y-4">
                <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl flex flex-col gap-3 mb-6">
                  <div className="flex gap-3">
                    <MapPin className="w-5 h-5 text-rose-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 dark:text-white">{newActivity.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{newActivity.location}</div>
                    </div>
                  </div>
                  
                  {/* Google Deep Links */}
                  <div className="flex gap-2 mt-2 pt-3 border-t border-slate-200 dark:border-slate-700">
                    <a 
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(newActivity.name + ' ' + newActivity.location)}`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 py-2 bg-white dark:bg-slate-700 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30 hover:bg-blue-50 dark:hover:bg-blue-900/50 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> Google Maps
                    </a>
                    <a 
                      href={`https://www.google.com/search?q=${encodeURIComponent(newActivity.name + ' ' + newActivity.location)}&tbm=isch`}
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex-1 flex items-center justify-center gap-2 py-2 bg-white dark:bg-slate-700 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" /> Photos
                    </a>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Select Day</label>
                    <div className="relative">
                      <ThemedSelect
                        value={selectedDay}
                        onChange={(e) => setSelectedDay(Number(e.target.value))}
                        className="editorial-select"
                      >
                        {itinerary.days.map(day => (
                          <option key={day.day} value={day.day}>Day {day.day} - {day.city}</option>
                        ))}
                      </ThemedSelect>
                      <Calendar className="absolute right-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Time</label>
                    <div className="relative">
                      <input
                        type="time"
                        value={newActivity.time}
                        onChange={(e) => setNewActivity({...newActivity, time: e.target.value})}
                        className="editorial-input"
                      />
                      <Clock className="absolute right-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Category</label>
                  <div className="relative">
                    <ThemedSelect
                      value={newActivity.type}
                      onChange={(e) => setNewActivity({...newActivity, type: e.target.value as ActivityType})}
                      className="editorial-select"
                    >
                      <option value="sight">Sightseeing</option>
                      <option value="food">Food & Dining</option>
                      <option value="culture">Culture & History</option>
                      <option value="shop">Shopping</option>
                      <option value="nature">Nature & Parks</option>
                      <option value="nightlife">Nightlife</option>
                      <option value="cafe">Cafe</option>
                      <option value="other">Other</option>
                    </ThemedSelect>
                    <Tag className="absolute right-3 top-3 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Notes (Optional)</label>
                  <textarea
                    value={newActivity.description}
                    onChange={(e) => setNewActivity({...newActivity, description: e.target.value})}
                    placeholder="Add notes, costs, or details..."
                    className="editorial-textarea" style={{ minHeight: '6rem', resize: 'none' }}
                  />
                </div>

                <button
                  onClick={confirmAddActivity}
                  className="w-full bg-slate-900 dark:bg-emerald-600 text-white font-bold py-4 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg shadow-slate-900/20 flex items-center justify-center gap-2 mt-4"
                >
                  <Save className="w-5 h-5" />
                  Save to Day {selectedDay}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
