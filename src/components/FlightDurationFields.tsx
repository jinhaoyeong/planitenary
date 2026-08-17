interface FlightDurationFieldsProps {
  hours: string;
  minutes: string;
  onHoursChange: (value: string) => void;
  onMinutesChange: (value: string) => void;
  error?: string;
  idPrefix: string;
}

/**
 * Hours + minutes for a Flight. Hidden for every other activity type by the
 * caller — this control never writes a raw `durationMinutes` label.
 */
export const FlightDurationFields = ({
  hours,
  minutes,
  onHoursChange,
  onMinutesChange,
  error,
  idPrefix,
}: FlightDurationFieldsProps) => {
  const hoursId = `${idPrefix}-hours`;
  const minutesId = `${idPrefix}-minutes`;
  const errorId = `${idPrefix}-error`;
  const describedBy = error ? errorId : undefined;

  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
        Duration
      </legend>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            id={hoursId}
            type="number"
            inputMode="numeric"
            min={0}
            max={24}
            step={1}
            value={hours}
            onChange={(event) => onHoursChange(event.target.value)}
            aria-label="Hours"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="editorial-input min-w-0 w-full"
          />
          <span aria-hidden="true" className="shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">
            hr
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            id={minutesId}
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            step={1}
            value={minutes}
            onChange={(event) => onMinutesChange(event.target.value)}
            aria-label="Minutes"
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy}
            className="editorial-input min-w-0 w-full"
          />
          <span aria-hidden="true" className="shrink-0 text-sm font-semibold text-slate-500 dark:text-slate-400">
            min
          </span>
        </div>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-xs font-semibold text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </fieldset>
  );
};
