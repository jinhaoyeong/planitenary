# Photo Gallery Feature Plan

## Overview
Add a photo gallery feature allowing users to upload and manage photos for each day of their itinerary. The design will be modern, creative, and match the existing app's aesthetic.

## Design Decisions

### 1. Storage Strategy
- **Use IndexedDB** for photo storage (via `idb` library or native API)
- Photos stored as compressed Base64 strings
- Fallback to localStorage for metadata only
- Reason: Photos can be large, localStorage has 5-10MB limit, IndexedDB has much larger capacity

### 2. Data Model Changes
Add to `DayPlan` interface in `src/data.ts`:
```typescript
interface DayPhoto {
  id: string;
  dataUrl: string;      // Compressed base64 image
  caption?: string;
  createdAt: string;
}

interface DayPlan {
  // ... existing fields
  photos?: DayPhoto[];
}
```

### 3. UI/UX Design

#### Day Card Enhancement (Overview Mode)
- Small photo preview strip at bottom of day cards
- Show up to 3 thumbnail previews with "+X more" indicator
- Clicking opens gallery modal

#### Gallery Modal (New Component)
- **Header**: Day title with close button
- **Masonry Grid**: Responsive photo grid with varied aspect ratios
- **Lightbox**: Click photo to view full-size with:
  - Smooth zoom animation
  - Navigation arrows
  - Caption editing
  - Delete option
- **Upload Area**: Drag & drop zone at top/bottom
  - Dashed border with icon
  - Supports multiple file selection
  - Auto-compresses images to max 1920px width
  - Shows upload progress

#### Design Elements (matching existing theme)
- Rounded corners: `rounded-2xl` for photos, `rounded-3xl` for modal
- Colors: Rose accent for actions, slate for backgrounds
- Animations: Framer Motion for modal open/close, photo hover effects
- Dark mode: Full support with proper contrast

### 4. Components to Create

| Component | Purpose |
|-----------|---------|
| `PhotoGallery.tsx` | Main gallery modal with grid and lightbox |
| `PhotoUploader.tsx` | Drag & drop upload with compression |
| `PhotoLightbox.tsx` | Full-screen photo viewer |

### 5. Files to Modify

| File | Changes |
|------|---------|
| `src/data.ts` | Add `DayPhoto` interface, update `DayPlan` |
| `src/components/ItineraryView.tsx` | Add photo preview to day cards, gallery trigger |
| `src/lib/storageResilience.ts` | Add photo sync helpers |
| `src/index.css` | Add any custom animations |

### 6. Technical Implementation

#### Image Compression
```typescript
// Compress image to max 1920px, JPEG quality 0.8
const compressImage = (file: File): Promise<string>
```

#### IndexedDB Storage
```typescript
// Separate store for photos to avoid localStorage limits
const PHOTO_STORE = 'day-photos'
const getPhotos = (dayId: string): Promise<DayPhoto[]>
const savePhoto = (dayId: string, photo: DayPhoto): Promise<void>
const deletePhoto = (dayId: string, photoId: string): Promise<void>
```

### 7. Visual Mockup

```
┌─────────────────────────────────────────────────────┐
│  Day 3 - Chongqing Exploration                      │
│  January 15, 2026                                   │
│  ─────────────────────────────────────────────────  │
│  ┌─────┐ ┌─────┐ ┌─────┐                            │
│  │ 📷  │ │ 📷  │ │ 📷  │  +2 more                  │
│  └─────┘ └─────┘ └─────┘                            │
└─────────────────────────────────────────────────────┘

Gallery Modal:
┌──────────────────────────────────────────────────────────┐
│  ← Day 3 Photos                                    ✕    │
├──────────────────────────────────────────────────────────┤
│  ┌──────────╭──────╮──────────────────────────┐         │
│  │          │      │                          │         │
│  │   📷     │  📷  │         📷               │         │
│  │          │      │                          │         │
│  │          ╰──────╯                          │         │
│  ├──────────┴──────┴──────────────────────────┤         │
│  │      📷          │          📷             │         │
│  └──────────────────┴─────────────────────────┘         │
│                                                          │
│  ┌─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┐         │
│  │    📤 Drop photos here or click to upload    │         │
│  └─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘         │
└──────────────────────────────────────────────────────────┘

Lightbox:
┌──────────────────────────────────────────────────────────┐
│                      ✕                                  │
│                                                          │
│          ◀           📷 Full Size           ▶           │
│                                                          │
│                    Caption here...              🗑️       │
└──────────────────────────────────────────────────────────┘
```

### 8. Implementation Steps

1. **Phase 1: Data Layer**
   - Add `DayPhoto` interface to `data.ts`
   - Create `photoStorage.ts` utility for IndexedDB operations
   - Add image compression utility

2. **Phase 2: Gallery Component**
   - Create `PhotoGallery.tsx` modal component
   - Implement masonry grid layout
   - Add photo upload functionality

3. **Phase 3: Lightbox**
   - Create `PhotoLightbox.tsx` component
   - Add navigation between photos
   - Add caption editing

4. **Phase 4: Integration**
   - Add photo preview strip to day cards in `ItineraryView.tsx`
   - Connect gallery to day cards
   - Add gallery button in day detail view

5. **Phase 5: Polish**
   - Add animations (Framer Motion)
   - Test dark mode
   - Mobile responsiveness

### 9. Dependencies
- No new npm packages required
- Use native IndexedDB API
- Use Canvas API for compression
- Use existing Framer Motion for animations

## Verification
1. Upload photo to a day - verify appears in gallery
2. View photo in lightbox - verify full size display
3. Delete photo - verify removed from gallery
4. Refresh page - verify photos persist
5. Test offline - verify photos still accessible
6. Test dark mode - verify proper contrast
7. Test mobile - verify responsive layout
