export type AppShellVisualMode = 'full-hero' | 'compact-chapter';

/**
 * The itinerary is the trip-entry chapter and owns the editorial cover.
 * Repeated-use tools should start near their own content instead of replaying
 * the cover and marquee on every navigation change.
 */
export const appShellVisualMode = (section: string): AppShellVisualMode =>
  section === 'itinerary' ? 'full-hero' : 'compact-chapter';

export const mapEmptyStateCopy = (savedLocationCount: number) => savedLocationCount === 0
  ? {
      title: 'No saved places yet.',
      detail: 'Add a located activity or search above to place the first pin on this trip.',
    }
  : {
      title: 'No places match these filters.',
      detail: 'Choose All Cities and All Locations to see every saved place.',
    };
