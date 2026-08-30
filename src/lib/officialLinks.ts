/**
 * Which URLs an attraction has, and which of them have earned authority.
 *
 * The mistake this file exists to avoid is the one already fixed for prices: a
 * single `website` field would force every surface to guess whether it points
 * at an operator's ticket desk, at some page loosely associated with the
 * place, or at a marketplace. A button reading "Tickets" is honest for exactly
 * one of those.
 *
 * ## Two strengths, two homes
 *
 * **`website` is unverified, and lives outside `officialLinks` for that
 * reason.** It comes from `PlaceCandidate.website`, which originates in a
 * community-edited OpenStreetMap tag. What is established here is that the URL
 * is a safe public HTTPS address and is not a known marketplace host — *not*
 * that the operator owns it. It was briefly called `officialLinks.homepage`,
 * which was a lie the type told: anything under `officialLinks` invites a
 * surface to print "Official". A doc comment cannot outvote a field name.
 *
 * **`officialLinks.tickets` is evidence-backed.** It is only ever the URL an
 * admission record cites when that record's source is the venue's own site.
 * Upstream, `officialTicketLinks` finds candidate pages by matching ticket and
 * admission wording, refuses anything that leaves the origin, and
 * `evidenceSources` only follows one if it publishes an actual fare. So a
 * stored ticket URL means: *a page on this operator's own site, reached by a
 * ticket-shaped link, that published a price.*
 *
 * A website never becomes a ticket URL. If the fare was published on that same
 * page the two collapse and only `website` is kept — charging admission is not
 * evidence of a ticket desk.
 */
import { isLikelyResellerUrl, isSafePublicUrl } from '../../supabase/functions/_shared/urlSafety';
import type { ActivityOfficialLinks } from '../data';
import type { AdmissionSource } from '../../supabase/functions/_shared/placeCost';

/**
 * A URL safe to show a traveller and not a marketplace, or nothing.
 *
 * This is the *whole* bar for `website`, and only the floor for `tickets`.
 * Both guards are reused rather than restated: a second copy of the reseller
 * host list would drift, and the day it drifts is the day a Viator page gets
 * captioned as the venue.
 */
export const safePlaceUrl = (raw: unknown): string | undefined => {
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

export interface AttractionLinkEvidence {
  /** The site the place record supplies. Community-sourced, unverified. */
  website?: string;
  /** How the admission figure was established, when there is one. */
  admissionSource?: AdmissionSource;
  /** The page that admission figure was read from. */
  admissionSourceUrl?: string;
}

export interface AttractionLinks {
  /** Unverified. Label it "Website". */
  website?: string;
  /** Authority established. May be labelled "Tickets". */
  officialLinks?: ActivityOfficialLinks;
}

/**
 * What a discovered place can honestly claim about its own links.
 *
 * Called once, where a candidate becomes an activity. Everything it returns
 * has already passed the safety and reseller guards, so the persistence
 * boundary is re-checking rather than deciding.
 */
export function attractionLinksFrom(evidence: AttractionLinkEvidence): AttractionLinks {
  const website = safePlaceUrl(evidence.website);

  // Only the venue's own site may nominate a ticket page. A fare from OSM, a
  // guide, or a category expectation says nothing about where to buy one.
  const admissionUrl = evidence.admissionSource === 'official-website'
    ? safePlaceUrl(evidence.admissionSourceUrl)
    : undefined;

  // The fare appearing on the website means that page published a price, not
  // that it sells tickets.
  const tickets = admissionUrl && !(website && samePage(admissionUrl, website))
    ? admissionUrl
    : undefined;

  return {
    ...(website ? { website } : {}),
    ...(tickets ? { officialLinks: { tickets } } : {}),
  };
}

/**
 * The persistence boundary for the unverified website.
 *
 * Re-runs the guards rather than trusting what was stored: a saved itinerary
 * is editable, syncable and restorable from backup, so a URL arriving here has
 * no more standing than one arriving from the network.
 */
export const sanitizeWebsite = (value: unknown): string | undefined => safePlaceUrl(value);

/**
 * The persistence boundary for authority-bearing links.
 *
 * A stored `homepage` key is deliberately ignored rather than migrated: this
 * branch never shipped one, and silently re-admitting an unverified URL into
 * an authority-bearing field is precisely the promotion this split exists to
 * prevent. Absence stays absence — never an empty object.
 */
export function sanitizeOfficialLinks(value: unknown): ActivityOfficialLinks | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const tickets = safePlaceUrl((value as Record<string, unknown>).tickets);
  return tickets ? { tickets } : undefined;
}
