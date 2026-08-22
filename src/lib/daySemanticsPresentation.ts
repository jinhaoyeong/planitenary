import type { DayPlan } from '../data';
import { sameCity } from '../../supabase/functions/_shared/dayCitySemantics';

export type DaySemanticKind = 'transfer' | 'day-trip' | 'activity-cities';

export interface DaySemanticModel {
  kind: DaySemanticKind;
  stayCity: string;
  activityCities: string[];
  transfer?: NonNullable<DayPlan['transfer']>;
}

export type DaySemanticsDay = Pick<DayPlan, 'stayCity' | 'activityCities' | 'transfer'>;

/**
 * Turns persisted Stage 2 fields into presentation facts.
 *
 * This deliberately does not inspect activity names, coordinates, or the
 * compatibility `city` alias. If the planner did not record a distinction,
 * the UI leaves the ordinary stay-city line alone.
 */
export const getDaySemanticModel = (day: DaySemanticsDay): DaySemanticModel | null => {
  const stayCity = day.stayCity.trim();
  if (!stayCity) return null;

  const activityCities = Array.isArray(day.activityCities)
    ? day.activityCities.filter((city): city is string => typeof city === 'string' && city.trim().length > 0)
    : [];
  const transfer = day.transfer;

  if (transfer?.from?.trim() && transfer.to?.trim()) {
    return { kind: 'transfer', stayCity, activityCities, transfer };
  }

  // A same-city entry is equivalent to the Stage 2 empty convention. Do not
  // create a label for it, and never infer a day trip from any other evidence.
  if (activityCities.length === 0 || (activityCities.length === 1 && sameCity(activityCities[0], stayCity))) {
    return null;
  }

  return {
    kind: activityCities.length === 1 ? 'day-trip' : 'activity-cities',
    stayCity,
    activityCities,
  };
};
