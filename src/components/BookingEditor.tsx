import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  TRAVEL_BOOKING_STATUSES,
  TRAVEL_BOOKING_TYPES,
  bookingCityKey,
  sortBookings,
  type TravelBooking,
  type TravelBookingStatus,
  type TravelBookingType,
} from '../lib/travelBooking';

interface BookingEditorProps {
  bookings: TravelBooking[];
  cities: string[];
  /** `YYYY-MM-DD`, used only to seed a new booking's date. */
  defaultDate?: string;
  onChange: (bookings: TravelBooking[]) => void;
  onClose: () => void;
}

const TYPE_LABELS: Record<TravelBookingType, string> = {
  flight: 'Flight',
  stay: 'Stay',
  rail: 'Rail',
  transfer: 'Transfer',
  'activity-ticket': 'Activity ticket',
};

const STATUS_LABELS: Record<TravelBookingStatus, string> = {
  planned: 'Planned',
  requested: 'Requested',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

/**
 * Identity for a booking the traveller just created.
 *
 * Generated here, in the editor, and never in `sanitizeItinerary` — that
 * function has to be idempotent down to its stringified output, so the one
 * place a random id is safe is the deliberate act of adding a record.
 */
const newBookingId = () => `booking-${crypto.randomUUID()}`;

const draftFor = (type: TravelBookingType, startDate: string, city: string | undefined): TravelBooking => ({
  id: newBookingId(),
  type,
  status: 'planned',
  title: '',
  startDate,
  city,
  cityKey: city ? bookingCityKey(city) : undefined,
});

/**
 * Which fields a type actually has.
 *
 * A stay has no origin and a flight has no room description. Showing every
 * field for every type would invite a traveller to fill in something the
 * timeline then has nowhere truthful to display.
 */
const FIELDS: Record<TravelBookingType, Array<'route' | 'city' | 'operator' | 'service' | 'cabin' | 'room' | 'party' | 'endTime' | 'zones'>> = {
  flight: ['route', 'operator', 'service', 'cabin', 'endTime', 'zones'],
  stay: ['city', 'operator', 'room'],
  rail: ['route', 'operator', 'service', 'endTime', 'zones'],
  transfer: ['route', 'operator', 'endTime', 'zones'],
  'activity-ticket': ['city', 'operator', 'party', 'endTime'],
};

/**
 * Zone names this runtime knows, for the datalist. Empty where the browser is
 * too old to enumerate them — the field still accepts a typed name, and the
 * sanitiser is what decides whether it is real.
 */
const KNOWN_TIME_ZONES: string[] = (() => {
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return typeof supported === 'function' ? supported('timeZone') : [];
  } catch {
    return [];
  }
})();

/**
 * Manual entry for everything the traveller has already arranged.
 *
 * V1 has no provider, so this is the only way a booking gets in — and it is
 * worth having on its own terms: a traveller who booked their flights six
 * months ago on an airline's own site has facts no API will ever hand back.
 *
 * Price is optional throughout. A confirmed reservation whose cost the
 * traveller does not care to record is still a constraint on the day, and
 * demanding a number would push people into typing a wrong one.
 */
export function BookingEditor({ bookings, cities, defaultDate, onChange, onClose }: BookingEditorProps) {
  const seedDate = defaultDate || new Date().toISOString().slice(0, 10);
  const [drafts, setDrafts] = useState<TravelBooking[]>(() => sortBookings(bookings));
  const [priceText, setPriceText] = useState<Record<string, string>>(() =>
    Object.fromEntries(bookings.filter((booking) => booking.price).map((booking) => [booking.id, String(booking.price!.amount)])),
  );

  const canSave = useMemo(
    () => drafts.every((booking) => booking.title.trim().length > 0 && booking.startDate.length === 10),
    [drafts],
  );

  const update = (id: string, patch: Partial<TravelBooking>) => {
    setDrafts((current) => current.map((booking) => (booking.id === id ? { ...booking, ...patch } : booking)));
  };

  const updateCity = (id: string, city: string) => {
    update(id, { city: city || undefined, cityKey: city ? bookingCityKey(city) : undefined });
  };

  /**
   * A price becomes a snapshot only when there is a number to snapshot.
   *
   * `retrievedAt` is stamped at the moment of entry, and the source is
   * `manual` — which is what later stops the card offering a refresh no system
   * can perform.
   */
  const updatePrice = (booking: TravelBooking, amountText: string, currency: string) => {
    setPriceText((current) => ({ ...current, [booking.id]: amountText }));
    const amount = Number.parseFloat(amountText);
    if (!Number.isFinite(amount) || amount < 0 || !currency.trim()) {
      update(booking.id, { price: undefined });
      return;
    }
    update(booking.id, {
      price: {
        amount,
        currency: currency.trim().toUpperCase(),
        source: 'manual',
        retrievedAt: new Date().toISOString(),
      },
    });
  };

  const addBooking = (type: TravelBookingType) => {
    setDrafts((current) => [...current, draftFor(type, seedDate, cities[0])]);
  };

  const removeBooking = (id: string) => {
    setDrafts((current) => current.filter((booking) => booking.id !== id));
  };

  return (
    <div className="journey-booking-editor">
      <header className="journey-route-editor-head">
        <div>
          <span>Bookings</span>
          <strong>What you have already arranged</strong>
        </div>
        <button type="button" className="journey-route-editor-close" onClick={onClose} aria-label="Close bookings">
          <X aria-hidden="true" />
        </button>
      </header>

      <div className="journey-route-editor-body">
        <p className="journey-booking-hint">
          Flights, rooms, trains and tickets you hold. The plan is built around these — a confirmed
          booking is never moved or removed by Smart Plan.
        </p>

        <div className="journey-booking-add">
          {TRAVEL_BOOKING_TYPES.map((type) => (
            <button type="button" key={type} onClick={() => addBooking(type)}>
              <Plus aria-hidden="true" />
              {TYPE_LABELS[type]}
            </button>
          ))}
        </div>

        <datalist id="booking-timezones">
          {KNOWN_TIME_ZONES.map((zone) => <option key={zone} value={zone} />)}
        </datalist>

        {drafts.length === 0 && (
          <p className="journey-booking-empty">Nothing added yet. Start with the flight that gets you there.</p>
        )}

        <div className="journey-booking-forms">
          {drafts.map((booking) => {
            const fields = FIELDS[booking.type];
            return (
              <fieldset className="journey-booking-form" key={booking.id}>
                <legend>{TYPE_LABELS[booking.type]}</legend>

                <button
                  type="button"
                  className="journey-booking-remove"
                  onClick={() => removeBooking(booking.id)}
                  aria-label={`Remove ${booking.title || TYPE_LABELS[booking.type]}`}
                >
                  <Trash2 aria-hidden="true" />
                </button>

                <label>
                  <span>Name</span>
                  <input
                    className="editorial-input"
                    value={booking.title}
                    placeholder={booking.type === 'stay' ? 'Hotel Nikko Osaka' : 'AirAsia AK 68'}
                    onChange={(event) => update(booking.id, { title: event.target.value })}
                  />
                </label>

                <label>
                  <span>Status</span>
                  <select
                    className="editorial-select"
                    value={booking.status}
                    onChange={(event) => update(booking.id, { status: event.target.value as TravelBookingStatus })}
                  >
                    {TRAVEL_BOOKING_STATUSES.map((status) => (
                      <option key={status} value={status}>{STATUS_LABELS[status]}</option>
                    ))}
                  </select>
                </label>

                {fields.includes('route') && (
                  <>
                    <label>
                      <span>From</span>
                      <input
                        className="editorial-input"
                        value={booking.origin || ''}
                        placeholder="KIX"
                        onChange={(event) => update(booking.id, { origin: event.target.value || undefined })}
                      />
                    </label>
                    <label>
                      <span>To</span>
                      <input
                        className="editorial-input"
                        value={booking.destination || ''}
                        placeholder="KUL"
                        onChange={(event) => update(booking.id, { destination: event.target.value || undefined })}
                      />
                    </label>
                  </>
                )}

                {fields.includes('city') && (
                  <label>
                    <span>City</span>
                    <input
                      className="editorial-input"
                      list={`booking-cities-${booking.id}`}
                      value={booking.city || ''}
                      onChange={(event) => updateCity(booking.id, event.target.value)}
                    />
                    <datalist id={`booking-cities-${booking.id}`}>
                      {cities.map((city) => <option key={city} value={city} />)}
                    </datalist>
                  </label>
                )}

                <label>
                  <span>{booking.type === 'stay' ? 'Check-in date' : 'Date'}</span>
                  <input
                    type="date"
                    className="editorial-input"
                    value={booking.startDate}
                    onChange={(event) => update(booking.id, { startDate: event.target.value })}
                  />
                </label>

                <label>
                  <span>{booking.type === 'stay' ? 'Check-in time' : 'Departs'}</span>
                  <input
                    type="time"
                    className="editorial-input"
                    value={booking.startTime || ''}
                    onChange={(event) => update(booking.id, { startTime: event.target.value || undefined })}
                  />
                </label>

                <label>
                  <span>{booking.type === 'stay' ? 'Check-out date' : 'End date'}</span>
                  <input
                    type="date"
                    className="editorial-input"
                    value={booking.endDate || ''}
                    onChange={(event) => update(booking.id, { endDate: event.target.value || undefined })}
                  />
                </label>

                {fields.includes('endTime') && (
                  <label>
                    <span>Arrives</span>
                    <input
                      type="time"
                      className="editorial-input"
                      value={booking.endTime || ''}
                      onChange={(event) => update(booking.id, { endTime: event.target.value || undefined })}
                    />
                  </label>
                )}

                {booking.type === 'stay' && (
                  <label>
                    <span>Check-out time</span>
                    <input
                      type="time"
                      className="editorial-input"
                      value={booking.endTime || ''}
                      onChange={(event) => update(booking.id, { endTime: event.target.value || undefined })}
                    />
                  </label>
                )}

                {fields.includes('operator') && (
                  <label>
                    <span>Operator</span>
                    <input
                      className="editorial-input"
                      value={booking.operator || ''}
                      onChange={(event) => update(booking.id, { operator: event.target.value || undefined })}
                    />
                  </label>
                )}

                {fields.includes('service') && (
                  <label>
                    <span>Number</span>
                    <input
                      className="editorial-input"
                      value={booking.serviceNumber || ''}
                      onChange={(event) => update(booking.id, { serviceNumber: event.target.value || undefined })}
                    />
                  </label>
                )}

                {/*
                  Without both zones the two clocks are not comparable and no
                  duration can be shown. Optional, because a traveller may not
                  know them and a domestic hop does not need them.
                */}
                {fields.includes('zones') && (
                  <>
                    <label>
                      <span>Departs timezone</span>
                      <input
                        className="editorial-input"
                        list="booking-timezones"
                        placeholder="Asia/Kuala_Lumpur"
                        value={booking.originTimeZone || ''}
                        onChange={(event) => update(booking.id, { originTimeZone: event.target.value || undefined })}
                      />
                    </label>
                    <label>
                      <span>Arrives timezone</span>
                      <input
                        className="editorial-input"
                        list="booking-timezones"
                        placeholder="Asia/Tokyo"
                        value={booking.destinationTimeZone || ''}
                        onChange={(event) => update(booking.id, { destinationTimeZone: event.target.value || undefined })}
                      />
                    </label>
                  </>
                )}

                {fields.includes('cabin') && (
                  <label>
                    <span>Cabin</span>
                    <input
                      className="editorial-input"
                      value={booking.cabin || ''}
                      placeholder="Economy"
                      onChange={(event) => update(booking.id, { cabin: event.target.value || undefined })}
                    />
                  </label>
                )}

                {fields.includes('room') && (
                  <label>
                    <span>Room</span>
                    <input
                      className="editorial-input"
                      value={booking.roomDescription || ''}
                      placeholder="Standard twin, non-smoking"
                      onChange={(event) => update(booking.id, { roomDescription: event.target.value || undefined })}
                    />
                  </label>
                )}

                {fields.includes('party') && (
                  <label>
                    <span>Travellers</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      className="editorial-input"
                      value={booking.partySize ?? ''}
                      onChange={(event) => update(booking.id, {
                        partySize: event.target.value ? Number(event.target.value) : undefined,
                      })}
                    />
                  </label>
                )}

                <label>
                  <span>Reference</span>
                  <input
                    className="editorial-input"
                    value={booking.reference || ''}
                    onChange={(event) => update(booking.id, { reference: event.target.value || undefined })}
                  />
                </label>

                <label>
                  <span>Price</span>
                  <input
                    className="editorial-input"
                    inputMode="decimal"
                    placeholder="Optional"
                    value={priceText[booking.id] ?? ''}
                    onChange={(event) => updatePrice(booking, event.target.value, booking.price?.currency || 'MYR')}
                  />
                </label>

                <label>
                  <span>Currency</span>
                  <input
                    className="editorial-input"
                    maxLength={3}
                    value={booking.price?.currency || ''}
                    placeholder="MYR"
                    onChange={(event) => updatePrice(booking, priceText[booking.id] ?? '', event.target.value)}
                  />
                </label>
              </fieldset>
            );
          })}
        </div>
      </div>

      <footer className="journey-booking-editor-foot">
        <button type="button" className="journey-booking-cancel" onClick={onClose}>Cancel</button>
        <button
          type="button"
          className="journey-booking-save"
          disabled={!canSave}
          onClick={() => { onChange(sortBookings(drafts)); onClose(); }}
        >
          Save bookings
        </button>
      </footer>
    </div>
  );
}
