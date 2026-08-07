/**
 * Turning an admission record into something a traveller can read.
 *
 * The rule this file exists to enforce: **there is no "Cost unknown".** That
 * string was doing two different jobs badly — standing in for "nobody published
 * a price", for "you pay per item once you are inside", and for "we never
 * looked" — and a traveller could not tell which. Every branch below says
 * something true and specific, and the hedged branches are audibly hedged.
 *
 * The second rule: a figure is shown in the currency it was published in.
 * Converting to the traveller's home currency is offered only as an explicitly
 * approximate second line, because an exchange rate is a moving number and the
 * ticket price is not.
 *
 * Shared by the discovery card and the itinerary day card so the same place
 * cannot describe its price two different ways on two screens.
 */

import type { AdmissionSource, PlaceAdmission } from '../../supabase/functions/_shared/placeCost';
import { formatCurrency } from './currency';

export interface AdmissionDisplay {
  /** Short, for the verdict strip. Never "Cost unknown". */
  headline: string;
  /** The qualifier that makes the headline honest. */
  note?: string;
  /** Fares beyond the headline one, for the expanded list. */
  fares: Array<{ label: string; value: string }>;
  /** Where the figure came from, as a sentence rather than an enum. */
  provenance?: string;
  /** True when a source published this; false when it is a category expectation. */
  sourced: boolean;
  /** The source's own words, when parsing could not represent all of them. */
  rawText?: string;
}

/**
 * Where a price came from, said plainly. `category` is deliberately wordy: it
 * is the one entry that is not a price at all, and it must not be mistakable
 * for one.
 */
const PROVENANCE: Record<AdmissionSource, string> = {
  'official-website': 'Admission information published on the venue’s own site',
  provider: 'Price from the map provider',
  'osm-tag': 'Price from community-maintained map data',
  wikivoyage: 'Price from the Wikivoyage city guide',
  category: 'No source published a price — this is only what places of this kind usually do',
};

const AUDIENCE_LABEL: Record<string, string> = {
  adult: 'Adult',
  child: 'Child',
  student: 'Student',
  senior: 'Senior',
  concession: 'Concession',
  group: 'Group',
  family: 'Family',
  person: 'Per person',
};

const audienceLabel = (audience: string) =>
  AUDIENCE_LABEL[audience] ?? audience.charAt(0).toUpperCase() + audience.slice(1);

/** What an unpriced place of this kind usually does. Never a price. */
const EXPECTATION_NOTE: Record<NonNullable<PlaceAdmission['expectation']>, string> = {
  'spending-inside': 'spending happens inside',
  'usually-ticketed': 'usually needs a ticket',
  'often-free': 'usually free to enter',
};

export interface AdmissionCopyOptions {
  /**
   * Approximate home-currency equivalent, when the caller has live rates.
   * Returns undefined when the conversion is not worth showing — the same
   * currency, or no rates yet.
   */
  toHomeCurrency?: (amount: number, currency: string) => string | undefined;
}

/**
 * The one place that decides what a price reads as.
 *
 * `admission` being undefined is not an error state: it means no source spoke
 * and the category had nothing to suggest either. That still gets a sentence.
 */
export function describeAdmission(
  admission: PlaceAdmission | undefined,
  options: AdmissionCopyOptions = {},
): AdmissionDisplay {
  const provenance = admission ? PROVENANCE[admission.source] : undefined;
  const rawText = admission?.rawText;

  if (!admission) {
    return { headline: 'No admission price published', fares: [], sourced: false };
  }

  if (admission.class === 'free') {
    return { headline: 'Free entry', fares: [], provenance, sourced: true, rawText };
  }

  if (admission.class === 'ticketed') {
    const fares = admission.fares ?? [];

    /**
     * Zero is a price a source can genuinely publish — OSM `charge=0`, a
     * schema.org `Offer` with `price: "0"` — and every upstream branch that
     * classifies is a place this could be missed. Costing nothing is what
     * "free" means, so the headline says so rather than printing `JP¥0`.
     * Guarded on *every* fare being zero, because a free child ticket beside a
     * paid adult one does not make the place free.
     */
    if (fares.length > 0 && fares.every((fare) => fare.amount === 0)) {
      return { headline: 'Free entry', fares: [], provenance, sourced: true, rawText };
    }
    // The adult fare is the one a traveller budgets against; if a source only
    // published a concession, say which one it is rather than implying it is
    // the standard price.
    const headlineFare = fares.find((fare) => fare.audience === 'adult') ?? fares[0];

    if (!headlineFare) {
      // A `fee=yes` tag with no readable charge. This is the case that used to
      // read "Cost unknown", and it is the one where that was most misleading:
      // we know perfectly well that it costs something.
      return {
        headline: 'Ticket required',
        note: 'no price published',
        fares: [],
        provenance,
        sourced: true,
        rawText,
      };
    }

    const converted = options.toHomeCurrency?.(headlineFare.amount, headlineFare.currency);
    return {
      headline: formatCurrency(headlineFare.amount, headlineFare.currency, { exact: true }),
      note: [
        headlineFare.audience === 'adult' ? 'adult ticket' : `${audienceLabel(headlineFare.audience).toLowerCase()} ticket`,
        headlineFare.note,
        converted ? `≈ ${converted}` : undefined,
      ].filter(Boolean).join(' · '),
      fares: fares
        .filter((fare) => fare !== headlineFare)
        .map((fare) => ({
          label: audienceLabel(fare.audience),
          value: fare.amount === 0
            ? 'Free'
            : [formatCurrency(fare.amount, fare.currency, { exact: true }), fare.note].filter(Boolean).join(' · '),
        })),
      provenance,
      sourced: true,
      rawText,
    };
  }

  if (admission.class === 'spend-based') {
    const spend = admission.typicalSpend;
    if (!spend) {
      return { headline: 'No admission price published', note: 'spending happens inside', fares: [], provenance, sourced: true, rawText };
    }
    const converted = options.toHomeCurrency?.(spend.amount, spend.currency);
    return {
      // "About" is doing real work: this is a typical spend, not a fare, and
      // presenting it as a price would be the same overclaim as a category one.
      headline: `About ${formatCurrency(spend.amount, spend.currency, { exact: true })}`,
      note: [`typical spend ${audienceLabel(spend.audience).toLowerCase()}`, converted ? `≈ ${converted}` : undefined]
        .filter(Boolean).join(' · '),
      fares: [],
      provenance,
      sourced: true,
      rawText,
    };
  }

  // Unknown. The category may still have something to say about the kind of
  // place it is — which is not the same as saying what it costs.
  return {
    headline: 'No admission price published',
    note: admission.expectation ? EXPECTATION_NOTE[admission.expectation] : undefined,
    fares: [],
    // Only attribute an expectation when it came from a category; a sourced
    // record that simply failed to parse should not claim a source for a price
    // it does not have.
    provenance: admission.source === 'category' ? provenance : undefined,
    sourced: false,
    rawText,
  };
}

/**
 * The shortest honest form, for a chip on a day card.
 *
 * A day card has to stay scannable, so this trades the qualifier for brevity —
 * but never for accuracy. "Pay inside" and "Ticket likely" are visibly hedged;
 * they do not claim a price exists or that one does not. Returns undefined when
 * there is genuinely nothing to say, so the chip is omitted rather than
 * occupying a row with a shrug.
 */
export function admissionChip(
  admission: PlaceAdmission | undefined,
  options: AdmissionCopyOptions = {},
): string | undefined {
  if (!admission) return undefined;
  if (admission.class === 'free') return 'Free entry';

  if (admission.class === 'ticketed') {
    const fares = admission.fares ?? [];
    // Same rule as the panel: costing nothing is what "free" means. The two
    // surfaces have to agree, which is the whole reason this module exists.
    if (fares.length > 0 && fares.every((fare) => fare.amount === 0)) return 'Free entry';
    const headline = fares.find((fare) => fare.audience === 'adult') ?? fares[0];
    if (!headline) return 'Ticket required';
    const converted = options.toHomeCurrency?.(headline.amount, headline.currency);
    const local = formatCurrency(headline.amount, headline.currency, { exact: true });
    return [local, headline.note, converted ? `≈ ${converted}` : undefined].filter(Boolean).join(' · ');
  }

  if (admission.class === 'spend-based') {
    return admission.typicalSpend
      ? `About ${formatCurrency(admission.typicalSpend.amount, admission.typicalSpend.currency, { exact: true })}`
      : 'Pay inside';
  }

  switch (admission.expectation) {
    case 'spending-inside': return 'Pay inside';
    case 'usually-ticketed': return 'Ticket likely';
    case 'often-free': return 'Usually free';
    default: return undefined;
  }
}

/** The whole thing on one line, for a chip or a compact row. */
export function admissionLine(
  admission: PlaceAdmission | undefined,
  options: AdmissionCopyOptions = {},
): string {
  const display = describeAdmission(admission, options);
  return display.note ? `${display.headline} · ${display.note}` : display.headline;
}
