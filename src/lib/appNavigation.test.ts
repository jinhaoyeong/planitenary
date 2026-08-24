import { describe, expect, it } from 'vitest';
import {
  ALL_NAV_ITEMS,
  MORE_NAV_GROUPS,
  PRIMARY_NAV_ITEMS,
  isMoreNavigationTab,
} from './appNavigation';

describe('Planitenary navigation hierarchy', () => {
  it('keeps exactly four route destinations plus the non-route More trigger in primary navigation', () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.id)).toEqual([
      'itinerary',
      'maps',
      'draft',
      'budget',
    ]);
  });

  it('keeps the approved More groups and all existing route ids reachable', () => {
    expect(MORE_NAV_GROUPS.map((group) => ({
      label: group.label,
      items: group.items.map((item) => item.id),
    }))).toEqual([
      { label: 'Trip', items: ['checklist', 'documents', 'photos'] },
      { label: 'Account', items: ['profile', 'settings'] },
    ]);
    expect(ALL_NAV_ITEMS.map((item) => item.id)).toEqual([
      'itinerary',
      'maps',
      'draft',
      'budget',
      'checklist',
      'documents',
      'photos',
      'profile',
      'settings',
    ]);
  });

  it('marks only More-owned destinations as active through the grouped menu', () => {
    expect(isMoreNavigationTab('checklist')).toBe(true);
    expect(isMoreNavigationTab('documents')).toBe(true);
    expect(isMoreNavigationTab('photos')).toBe(true);
    expect(isMoreNavigationTab('profile')).toBe(true);
    expect(isMoreNavigationTab('settings')).toBe(true);
    expect(isMoreNavigationTab('itinerary')).toBe(false);
    expect(isMoreNavigationTab('maps')).toBe(false);
    expect(isMoreNavigationTab('draft')).toBe(false);
    expect(isMoreNavigationTab('budget')).toBe(false);
  });
});
