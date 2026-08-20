/**
 * One real place, shown the same way wherever it appears.
 *
 * Ask and Smart Plan reach a place card through completely different proofs —
 * one earns its reference inside a single model turn, the other recovers one
 * the server stored when discovery could prove it — but a traveller looking at
 * a photograph should not be able to tell which screen resolved it, and the two
 * must not be able to drift into showing the same place differently.
 *
 * Everything here is already resolved. This component decides nothing about
 * *which* place it is displaying: it receives a `StructuredPlaceCard` the
 * server built and renders exactly what that card asserts. There is no lookup,
 * no fallback and no name matching in this file, because there is no identity
 * question left to answer by the time it runs.
 */
import { useState } from 'react';
import type { StructuredPlaceCard } from '../../supabase/functions/_shared/placeReference';

/** How an existing decision reads on a card. Status is never colour alone. */
const DECISION_LABEL: Record<NonNullable<StructuredPlaceCard['decision']>, string> = {
  'must-do': 'Must do',
  interested: 'Interested',
  skip: 'Skipped',
  visited: 'Visited',
};

export interface PlaceCardProps {
  card: StructuredPlaceCard;
  /** Rendered as a list item inside Ask; standalone under a Smart Plan action. */
  as?: 'li' | 'div';
}

/**
 * Compact on purpose. Both surfaces are drawers beside the plan, not a second
 * discovery page — a card supports the thing it sits under rather than
 * competing with it.
 *
 * The photo is a real photograph or nothing: a card whose picture fails
 * validation keeps the place and drops the image, exactly as the deck does,
 * because a place worth recommending is still worth recommending without one.
 */
export function PlaceCard({ card, as = 'li' }: PlaceCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showPhoto = Boolean(card.image) && !imageFailed;
  const where = [card.area, card.city].filter(Boolean).join(' · ');
  const Container = as;

  return (
    <Container className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      {showPhoto && card.image && (
        <img
          src={card.image.url}
          alt={`${card.name}${where ? `, ${where}` : ''}`}
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
          className="h-28 w-full object-cover"
        />
      )}
      <div className="p-3">
        <p className="text-sm font-semibold leading-5 text-slate-900 dark:text-slate-100">{card.name}</p>
        {where && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{where}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
          {card.decision && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {DECISION_LABEL[card.decision]}
            </span>
          )}
          {card.onDay !== undefined && <span>On day {card.onDay}</span>}
        </div>
        {/*
          The credit is not decoration. CC BY and CC BY-SA both require the
          author be named, so this line is part of the permission to show the
          photograph, and it links the file page where the full licence lives.
        */}
        {showPhoto && card.image && (
          <a
            href={card.image.sourcePage}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 block truncate text-[11px] text-slate-400 underline decoration-dotted underline-offset-2 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-slate-500 dark:hover:text-slate-300"
          >
            {card.image.attribution}
          </a>
        )}
      </div>
    </Container>
  );
}
