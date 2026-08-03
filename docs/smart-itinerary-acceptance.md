# Smart Itinerary acceptance seed

Use this seed on the `agent/trip-intelligence-planner` branch for manual acceptance. It is intentionally small and includes the important safety cases.

## Seed data

Create a five-day trip with these confirmed activities in the inbox:

| Activity | Coordinates | Cost | State |
| --- | --- | --- | --- |
| Fushimi Inari | `35.0394, 135.7729` | `¥0` | unlocked |
| Kiyomizu-dera | `35.0037, 135.7850` | `¥400` | schedule locked |
| Arashiyama Bamboo Grove | `35.0170, 135.6713` | `¥0` | unlocked |
| Kyoto Railway Museum | unknown | `$25` | unlocked |
| Dinner reservation | `35.0116, 135.7681` | `¥3,000` | fully locked |

Add one existing day with four main activities so it is visibly overloaded. Set the museum opening window to `09:00–17:00` while scheduling it at `18:00`. Set the trip budget currency to `JPY`, add an unavailable window during the dinner reservation, and leave at least one activity without coordinates.

## Acceptance flows

1. Confirm all five activities in the inbox, build the first itinerary, and verify every activity is assigned exactly once across multiple days.
2. Optimise the overloaded day and verify the schedule-locked and fully locked activities do not move.
3. Optimise the whole trip and verify an unlocked activity can move to a quieter compatible day.
4. Open a preview, edit or lock an activity, and confirm the old preview refuses to apply.
5. Select only one move and one insertion. Apply and verify unselected proposal rows remain unchanged.
6. Apply an optimisation, edit an activity note, then undo. The planner schedule should revert while the note remains.
7. Confirm the preview explains approximate movement, unknown coordinates, mixed currencies, budget, unavailable-time, and opening-hours warnings in plain language.
8. Repeat the preview at narrow/mobile width and verify the change list scrolls and all controls remain reachable.
