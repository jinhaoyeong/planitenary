# Adaptive Destination Design evidence (PR #8)

Screenshots and persistence results from the Adaptive Destination Design System
acceptance pass. Kept in-repo so reviewers are not dependent on Cursor artifact URLs.

Capture mode (DEV / `VITE_ENABLE_HANDBOOK_QA=true` only):

```text
?handbookQa=japan|korea|italy|switzerland&intensity=subtle|balanced|immersive&view=home|itinerary|settings&theme=light|dark
```

## Mobile acceptance (true 390 CSS px viewport, deviceScaleFactor 2 → 780×1688 PNG)

| File | What it shows |
|------|----------------|
| `mobile-japan-subtle-home-light.png` | Japan home, Subtle |
| `mobile-japan-balanced-home-light.png` | Japan home, Balanced + Japanese title wrap |
| `mobile-japan-immersive-home-light.png` | Japan home, Immersive |
| `mobile-japan-immersive-home-dark.png` | Japan immersive dark contrast |
| `mobile-korea-balanced-home-light.png` | Korea home + Korean title |
| `mobile-korea-balanced-home-dark.png` | Korea home dark |
| `mobile-italy-long-title-home-light.png` | Long English title wrap |
| `mobile-italy-immersive-itinerary-light.png` | Italy itinerary cards + motifs |
| `mobile-switzerland-balanced-settings-dark.png` | Settings chips / recipe controls dark |

Measured at capture time: `innerWidth=390`, `scrollWidth=390` (no horizontal overflow), primary pill buttons ≥ ~47px tall, desktop header nav hidden.

## Interactive persistence (Settings UI in handbook capture)

| File | What it shows |
|------|----------------|
| `mobile-persist-01-automatic-or-locked.png` | Switzerland Automatic → Nature Expedition |
| `mobile-persist-02-manual-lock.png` | Manual Warm Postcard lock (`recipeSource: override`) |
| `mobile-persist-02b-destination-change-locked.png` | Lock retained after destination edit |
| `mobile-persist-03-after-reload.png` | Capture mode reloads from URL → Automatic again |
| `mobile-persist-04-reset-automatic.png` | Reset design to default |
| `mobile-persist-05-korea-independent.png` | Korea scenario stays Modern Metropolitan |
| `mobile-persist-05-after-scenario-switch.png` | Return to Switzerland does not carry Korea lock |
| `persistence-results.json` | Machine-readable assertion log |

## Desktop handbook captures

| File | What it shows |
|------|----------------|
| `handbook-japan-subtle-home-desktop-light.webp` | Japan Subtle desktop |
| `handbook-japan-balanced-home-desktop-light.webp` | Japan Balanced desktop |
| `handbook-japan-immersive-home-desktop-light.webp` | Japan Immersive desktop |
| `handbook-japan-immersive-home-desktop-dark.webp` | Japan Immersive dark desktop |
| `handbook-korea-balanced-home-desktop-light.webp` | Korea home desktop |
| `handbook-korea-balanced-settings-desktop-light.webp` | Korea settings desktop |
| `handbook-italy-balanced-itinerary-desktop-light.webp` | Italy itinerary desktop |
| `handbook-switzerland-balanced-home-desktop-light.webp` | Switzerland home desktop |

## Notes

- Capture mode is URL-driven and intentionally resets on reload / scenario switch.
- Durable reload persistence of `visualDesign.recipeOverride` is covered by `src/lib/visualIdentity.test.ts` (sanitize/reload + destination lock) and by the storage independence check in `persistence-results.json`.
- Production builds ignore `handbookQa` / `visualQa` unless `VITE_ENABLE_HANDBOOK_QA=true`.
