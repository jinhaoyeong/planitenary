# Country picker evidence (PR #9)

Screenshots and verification notes for the ISO badge country picker.
Kept in-repo so reviewers are not dependent on Cursor artifact URLs.

| File | What it shows |
|------|----------------|
| `country-picker-mobile.png` | Mobile wizard step with ISO badges (JP, KR, CN…) |
| `country-picker-desktop.png` | Desktop wizard step with the same mark system |
| `country-picker-dark.png` | Dark-mode badge contrast |
| `country-picker-long-name.png` | Long country name wrapping (United Arab Emirates) |

## Verification summary

### Cross-platform consistency
- Mobile and desktop use the same `CountryMark` ISO badge component.
- No flag emoji (🇯🇵) in the picker flow.
- Empty trigger uses a Lucide globe icon, not 🌍.

### Accessibility
- Each option exposes `aria-label="Japan, JPY"` via `countryOptionLabel`.
- Trigger announces full country + currency when known (`Country, Japan, JPY`).
- ISO badges are `aria-hidden`; screen readers read name and currency, not only the code.
- Listbox uses `aria-activedescendant` for keyboard highlight.
- Search input is labelled for name and ISO code filtering.

### Keyboard
- **Arrow Up / Down** — move highlight (wraps at ends).
- **Home / End** — jump to first / last result.
- **Enter** — select highlighted country.
- **Escape** — close menu and return focus to trigger.
- **Arrow Down / Enter / Space** on closed trigger — open menu.

### Search
- By country name (`japan`, `united arab`).
- By alias (`uae`).
- By ISO code (`jp`, `ae`).

### Fallbacks
- Unknown legacy two-letter codes render as `Saved country (ZZ)` with a badge, without breaking the picker.
- Long names truncate with `title` tooltip (e.g. United Arab Emirates).

### Dark mode
- Badge colours use theme-aware CSS (`color-mix` with accent + elevated background) for stronger contrast in `.dark`.

## Automated tests

`src/lib/destinations.test.ts` covers:
- `countryCodeLabel`
- `countryOptionLabel`
- `searchCountries` (name, alias, ISO)
- `resolveCountrySelection` (known + legacy)

135 tests passing overall.
