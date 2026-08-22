import { ArrowRight, MapPin } from 'lucide-react';
import { clsx } from 'clsx';
import type { DaySemanticsDay, DaySemanticModel } from '../lib/daySemanticsPresentation';
import { getDaySemanticModel } from '../lib/daySemanticsPresentation';

const semanticLabel = (model: DaySemanticModel): string => {
  if (model.kind === 'transfer') return `Transfer day from ${model.transfer!.from} to ${model.transfer!.to}. Staying in ${model.stayCity} tonight.`;
  if (model.kind === 'day-trip') return `${model.activityCities[0]} day trip. Staying in ${model.stayCity}.`;
  return `Activities in ${model.activityCities.join(', ')}. Staying in ${model.stayCity}.`;
};

export const DaySemantics = ({ day, mode = 'compact' }: {
  day: DaySemanticsDay;
  mode?: 'compact' | 'detail';
}) => {
  const model = getDaySemanticModel(day);
  if (!model) return null;

  const isDetail = mode === 'detail';
  const activityText = model.activityCities.join(' · ');

  return (
    <div
      role="note"
      aria-label={semanticLabel(model)}
      data-day-semantics={model.kind}
      className={clsx(
        'border border-slate-200/80 bg-slate-50/80 text-slate-700 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200',
        isDetail ? 'rounded-2xl px-3.5 py-3 md:px-4 md:py-3.5' : 'mt-3 rounded-2xl px-3 py-2.5',
      )}
    >
      {model.kind === 'transfer' ? (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
              <span>{model.transfer!.from}</span>
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 text-rose-500" />
              <span>{model.transfer!.to}</span>
            </span>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-rose-600 dark:text-rose-300">Transfer day</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs md:text-sm">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-rose-500" />
            <span>Staying in <strong className="font-semibold text-slate-900 dark:text-white">{model.stayCity}</strong> tonight</span>
          </div>
          {activityText && (
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Activities: {activityText}</div>
          )}
        </>
      ) : (
        <>
          <div className="font-semibold text-slate-900 dark:text-white">
            {model.kind === 'day-trip' ? `${activityText} day trip` : `Activities in ${activityText}`}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs md:text-sm">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-rose-500" />
            <span>Staying in <strong className="font-semibold text-slate-900 dark:text-white">{model.stayCity}</strong></span>
          </div>
        </>
      )}
    </div>
  );
};
