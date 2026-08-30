/**
 * Which official URLs an attraction has, and what each one is allowed to mean.
 *
 * The mistake this file exists to avoid is the one just fixed for prices: a
 * single `website` field would force every surface to guess whether it points
 * at an operator's homepage, at their ticket desk, or at a marketplace. Those
 * are three different claims, and a button reading "Tickets" is only honest
 * for one of them.
 *
 * ## What can actually be proven
 *
 * **`homepage` is weaker than its name suggests.** It comes from
 * `PlaceCandidate.website`, which originates in a community-edited
 * OpenStreetMap tag. What is verified here is that the URL is a safe public
 * HTTPS address and is not a known marketplace host — *not* that the operator
 * owns it. That is the strongest claim the current pipeline supports, and
 * inventing a stronger one is exactly the failure mode this layer keeps
 * refusing.
 *
 * **`tickets` is genuinely evidence-backed.** It is only ever the URL an
 * admission record cites when that record's source is the venue's own site.
 * Upstream, `officialTicketLinks` finds candidate pages by matching ticket and
 * admission wording, refuses anything that leaves the origin, and
 * `evidenceSources` only follows one if it publishes an actual fare. So a
 * stored ticket URL means: *a page on this operator's own site, reached by a
 * ticket-shaped link, that published a price.*
 *
 * A homepage never becomes a ticket URL. If the fare was published on the
 * homepage itself the two URLs are the same page, and only `homepage` is kept
 * — charging admission is not evidence of a ticket desk.
 */
import { isLikelyResellerUrl, isSafePublicUrl } from '../../supabase/functions/_shared/urlSafety';
import type { ActivityOfficialLinks } from '../data';
import type { AdmissionSource } from '../../supabase/functions/_shared/placeCost';

/**
 * A URL allowed to stand for the operator, or nothing.
 *
 * Both guards are reused rather than restated: `isSafePublicUrl` refuses
 * anything the app should not send a traveller to, and `isLikelyResellerUrl`
 * refuses a marketplace wearing the word "official". A second copy of either
 * would drift.
 */
const officialUrl = (raw: unknown): string | undefined => {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || !isSafePublicUrl(trimmed) || isLikelyResellerUrl(trimmed)) return undefined;
  return trimmed;
};

/** Same page, allowing for a trailing slash or a fragment. */
const samePage = (a: string, b: string): boolean => {
  const normalise = (raw: string) => {
    try {
      const url = new URL(raw);
      url.hash = '';
      return `${url.origin}${url.pathname.replace(/\/$/, '')}${url.search}`.toLowerCase();
    } catch {
      return raw.trim().toLowerCase();
    }
  };
  return normalise(a) === normalise(b);
};

/** Nothing survived, so store nothing — absence is a state, not an empty object. */
const orUndefined = (links: ActivityOfficialLinks): ActivityOfficialLinks | undefined =>
  (links.homepage || links.tickets ? links : undefined);

export interface OfficialLinkEvidence {
  /** The operator's site as the place record supplies it. Community-sourced. */
  website?: string;
  /** How the admission figure was established, when there is one. */
  admissionSource?: AdmissionSource;
  /** The page that admission figure was read from. */
  admissionSourceUrl?: string;
}

/**
 * What a discovered place can honestly claim about its own links.
 *
 * Called once, where a candidate becomes an activity. Everything it returns
 * has already passed the safety and reseller guards, so the persistence
 * boundary is re-checking rather than deciding.
 */
export function officialLinksFrom(evidence: OfficialLinkEvidence): ActivityOfficialLinks | undefined {
  const homepage = officialUrl(evidence.website);

  // Only the venue's own site may nominate a ticket page. A fare from OSM, a
  // guide, or a category expectation says nothing about where to buy one.
  const admissionUrl = evidence.admissionSource === 'official-website'
    ? officialUrl(evidence.admissionSourceUrl)
    : undefined;

  // The fare appearing on the homepage means the homepage published a price,
  // not that it sells tickets.
  const tickets = admissionUrl && !(homepage && samePage(admissionUrl, homepage))
    ? admissionUrl
    : undefined;

  return orUndefined({ ...(homepage ? { homepage } : {}), ...(tickets ? { tickets } : {}) });
}

/**
 * The persistence boundary.
 *
 * Re-runs every guard rather than trusting what was stored: a saved itinerary
 * is editable, syncable and restorable from backup, so a URL arriving here has
 * no more standing than one arriving from the network. A failing URL is
 * dropped on its own — never the activity that holds it.
 */
export function sanitizeOfficialLinks(value: unknown): ActivityOfficialLinks | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const homepage = officialUrl(raw.homepage);
  const tickets = officialUrl(raw.tickets);
  return orUndefined({
    ...(homepage ? { homepage } : {}),
    // A stored pair that has collapsed onto one page keeps only the homepage,
    // so a reload cannot promote a homepage into a ticket desk.
    ...(tickets && !(homepage && samePage(tickets, homepage)) ? { tickets } : {}),
  });
}
