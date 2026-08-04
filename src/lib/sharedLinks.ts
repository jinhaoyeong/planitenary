/**
 * Shared travel links.
 *
 * The honest answer to "pull reviews from TikTok, Douyin and RedNote" is that
 * none of them offer open public travel search to commercial products. TikTok's
 * Research API is not available to commercial users, and its Display API is
 * scoped to an authorised creator's own videos. Douyin and RedNote require
 * partner agreements.
 *
 * So rather than pretending — or scraping, which would be both fragile and
 * against their terms — the traveller can paste any link they already found and
 * we resolve it into evidence. That works on day one, on every platform, and
 * upgrades cleanly to bulk ingestion if partner access is ever granted.
 */

import type { EvidenceSource } from './travelEvidence';

export interface RecognisedLink {
  source: EvidenceSource;
  url: string;
  /** Platform's own id for the item, when the URL carries one. */
  sourceItemId?: string;
  /** Whether the backend can currently fetch metadata for this platform. */
  resolvable: boolean;
  /** Shown when we cannot fetch it, so the traveller knows what to do. */
  note?: string;
}

interface Matcher {
  source: EvidenceSource;
  hosts: string[];
  /** Extracts the platform's item id from the URL. */
  id?: (url: URL) => string | undefined;
  resolvable: boolean;
  note?: string;
}

const MATCHERS: Matcher[] = [
  {
    source: 'youtube',
    hosts: ['youtube.com', 'm.youtube.com', 'youtu.be'],
    id: (url) => (url.hostname.includes('youtu.be')
      ? url.pathname.slice(1)
      : url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).pop()) || undefined,
    resolvable: true,
  },
  {
    source: 'google-places',
    hosts: ['google.com', 'maps.google.com', 'goo.gl', 'maps.app.goo.gl'],
    id: (url) => {
      const match = url.search.match(/place_id:([\w-]+)/);
      return match?.[1];
    },
    resolvable: true,
  },
  {
    source: 'tripadvisor',
    hosts: ['tripadvisor.com', 'tripadvisor.co.uk', 'tripadvisor.com.au'],
    resolvable: false,
    note: 'We will save the link and match the place. Review text needs licensed access.',
  },
  {
    source: 'tiktok',
    hosts: ['tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
    id: (url) => url.pathname.match(/\/video\/(\d+)/)?.[1],
    resolvable: false,
    note: 'TikTok does not offer public search to apps. We will save your link and match the place.',
  },
  {
    source: 'douyin',
    hosts: ['douyin.com', 'v.douyin.com', 'iesdouyin.com'],
    id: (url) => url.pathname.match(/\/video\/(\d+)/)?.[1],
    resolvable: false,
    note: 'Douyin needs partner access. We will save your link and match the place.',
  },
  {
    source: 'rednote',
    hosts: ['xiaohongshu.com', 'xhslink.com'],
    id: (url) => url.pathname.split('/').filter(Boolean).pop(),
    resolvable: false,
    note: 'RedNote needs partner access. We will save your link and match the place.',
  },
];

const normaliseHost = (hostname: string) => hostname.replace(/^www\./, '').toLowerCase();

/**
 * Identify a pasted link. Anything we do not recognise is still accepted as a
 * generic shared source — a personal blog post is legitimate travel evidence,
 * and refusing it would be worse than storing it with lower authority.
 */
export function recogniseLink(input: string): RecognisedLink | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Reject any non-web scheme *before* normalising. Blindly prefixing
  // "https://" would turn `javascript:alert(1)` or `file:///etc/passwd` into a
  // URL that parses cleanly and then gets stored and rendered as an anchor.
  const declaredScheme = trimmed.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
  if (declaredScheme && declaredScheme !== 'http' && declaredScheme !== 'https') return null;

  let url: URL;
  try {
    url = new URL(declaredScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // A bare scheme with no host is not a shareable link.
  if (!url.hostname || !url.hostname.includes('.')) return null;

  const host = normaliseHost(url.hostname);
  const matcher = MATCHERS.find((entry) => entry.hosts.some(
    (candidate) => host === candidate || host.endsWith(`.${candidate}`),
  ));

  if (!matcher) {
    return { source: 'user-shared', url: url.toString(), resolvable: true };
  }

  return {
    source: matcher.source,
    url: url.toString(),
    sourceItemId: matcher.id?.(url),
    resolvable: matcher.resolvable,
    note: matcher.note,
  };
}

/** Extract every link from text the traveller pasted or shared in. */
export function extractLinks(text: string): RecognisedLink[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) || [];
  const seen = new Set<string>();
  const links: RecognisedLink[] = [];
  for (const match of matches) {
    const link = recogniseLink(match);
    if (link && !seen.has(link.url)) {
      seen.add(link.url);
      links.push(link);
    }
  }
  return links;
}

/**
 * What to tell the traveller after they share a batch of links. Names the
 * platforms we cannot read rather than failing quietly, so expectations stay
 * accurate.
 */
export function describeImport(links: RecognisedLink[]): string {
  if (links.length === 0) return 'No links found. Paste a link to a video, review or map listing.';

  const resolvable = links.filter((link) => link.resolvable).length;
  const manual = links.length - resolvable;
  const platforms = [...new Set(links.filter((link) => !link.resolvable).map((link) => link.source))];

  if (manual === 0) return `Reading ${resolvable} ${resolvable === 1 ? 'link' : 'links'}.`;
  if (resolvable === 0) {
    return `Saved ${manual} ${manual === 1 ? 'link' : 'links'}. ${platforms.join(' and ')} ${platforms.length === 1 ? 'does' : 'do'} not allow apps to read posts, so tell us which place each one is about.`;
  }
  return `Reading ${resolvable}, and saving ${manual} from ${platforms.join(' and ')} for you to label.`;
}
