import { BookOpen, Calendar, CheckSquare, FileText, Image as ImageIcon, Map, Settings, UserRound, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AppTabId = 'itinerary' | 'draft' | 'budget' | 'maps' | 'checklist' | 'documents' | 'photos' | 'profile' | 'settings';

export interface NavigationItem {
  id: AppTabId;
  label: string;
  icon: LucideIcon;
}

export interface NavigationGroup {
  label: string;
  items: NavigationItem[];
}

export const PRIMARY_NAV_ITEMS: NavigationItem[] = [
  { id: 'itinerary', label: 'Itinerary', icon: Calendar },
  { id: 'maps', label: 'Maps', icon: Map },
  { id: 'draft', label: 'Draft', icon: BookOpen },
  { id: 'budget', label: 'Budget', icon: Wallet },
];

export const MORE_NAV_GROUPS: NavigationGroup[] = [
  {
    label: 'Trip',
    items: [
      { id: 'checklist', label: 'Checklist', icon: CheckSquare },
      { id: 'documents', label: 'Documents', icon: FileText },
      { id: 'photos', label: 'Photo Wall', icon: ImageIcon },
    ],
  },
  {
    label: 'Account',
    items: [
      { id: 'profile', label: 'Profile', icon: UserRound },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const ALL_NAV_ITEMS: NavigationItem[] = [
  ...PRIMARY_NAV_ITEMS,
  ...MORE_NAV_GROUPS.flatMap((group) => group.items),
];

export const isMoreNavigationTab = (tab: AppTabId) =>
  MORE_NAV_GROUPS.some((group) => group.items.some((item) => item.id === tab));
