# Planitenary Editorial Journey Design System

Version: 1.0  
Status: Approved direction, implementation specification  
Scope: Responsive web, PWA, iOS, and Android surfaces rendered from the shared React application

## 1. Purpose

This system translates the five approved Planitenary concept boards into a reusable product language for the full application redesign.

It is not a marketing-site system. Planitenary should feel like a calm, useful planning workspace whose illustrations make travel feel human and memorable. The interface communicates reliability through sources, route status, explicit unknowns, and reversible AI proposals.

The five source boards are stored in:

`C:\Users\jinhao\.codex\generated_images\01a034d6-c1e1-7183-8390-a0bb9d352ea1`

| Board | File | Primary pattern |
|---|---|---|
| My Trips, first direction | `exec-f5489c10-91af-456f-8d6f-d4d3959f2cab.png` | Golden route hero and compact trip shelf |
| My Trips, refined direction | `exec-1c2cfcb3-78c1-41e5-bfd8-95a1befaa4f3.png` | Coastal route hero, line motifs, final shell language |
| Plan a Trip | `exec-02fb8b66-f029-43c6-be44-7634271f860a.png` | Split form and narrative illustration |
| Choose Places | `exec-910cd7b0-bd9c-45ba-a457-21a1bd9139fe.png` | Discovery card, shortlist, evidence link |
| Day Plan | `exec-6e65bbca-116e-4e2d-ad22-415c2ca5489f.png` | Timeline, contextual AI proposal, tall route art |

The production illustration prompts are documented in [planitenary-illustration-prompts.md](./planitenary-illustration-prompts.md).

## 2. Product design principles

### 2.1 The app comes first

- Open on the traveller's work, not a sales pitch.
- Do not add pricing cards, testimonials, logo walls, feature grids, or oversized promotional copy inside the product.
- A page gets one clear primary action. Secondary actions remain visibly secondary.

### 2.2 Illustration creates emotion; UI carries facts

- Use one dominant editorial illustration per major screen.
- Keep facts, prices, opening hours, routes, and sources in structured UI outside the artwork.
- Never use generated artwork as evidence of what a real attraction, hotel, restaurant, or neighbourhood looks like.
- Real place imagery remains authentic, licensed, credited, and tied to the correct place identity.

### 2.3 Reliability is visible at the point of doubt

- Put source access beside the fact it supports.
- Distinguish live routing from estimated routing.
- Label unavailable or unknown information honestly.
- AI proposes; the traveller reviews and applies.
- Every applied AI change must be reversible.

### 2.4 Calm does not mean empty

- Use generous space to separate decisions, not to imitate a luxury landing page.
- Preserve useful density in timelines, source summaries, and trip forms.
- Prefer dividers, alignment, and type hierarchy over nested cards.

### 2.5 Responsive means recomposed

- Desktop and mobile preserve the same hierarchy, not necessarily the same geometry.
- Important artwork receives separate landscape and portrait compositions when cropping would remove the route, traveller, or vehicle.
- Sheets replace sidebars on compact screens.

## 3. Non-goals

The redesign does not introduce:

- A booking marketplace
- Deals, rewards, loyalty, or referral mechanics
- A social feed, likes, followers, or public comments
- A large branded AI personality
- A permanent chatbot obstructing itinerary content
- Gamified completion scores
- Feature-heavy dashboards
- Generated photographs for factual place representation

Existing secondary tools such as budget, checklist, documents, photos, and settings may remain, but they do not compete with planning, discovery, the itinerary, and contextual AI in primary navigation.

## 4. Foundation tokens

### 4.1 Token architecture

Use semantic tokens in components. Do not introduce raw Tailwind colour names or one-off hex values in redesigned components.

The system separates four concerns:

1. **Foundation:** paper, ink, borders, spacing, radii, and shadows.
2. **Action:** primary and secondary interactive states.
3. **Semantic status:** success, warning, danger, information, live, estimated, and unknown.
4. **Trip identity:** destination-derived accent and illustration palette.

Trip identity may change accent colour, motifs, and artwork. It must not unpredictably change component anatomy, reading order, focus appearance, or control size.

### 4.2 Light palette

| Token | Value | Role |
|---|---:|---|
| `--paper-canvas` | `#FAF7EF` | Application background |
| `--paper-surface` | `#FFFDF7` | Cards, forms, drawers |
| `--paper-sunken` | `#F3EEE4` | Quiet groups, selected summaries |
| `--ink-primary` | `#173B2E` | Headings, primary text, actions |
| `--ink-body` | `#293C34` | Body text |
| `--ink-muted` | `#59665E` | Metadata and secondary copy |
| `--line-soft` | `#DED5C7` | Surface and control borders |
| `--line-strong` | `#BFB4A4` | Selected or emphasized boundaries |
| `--action-primary` | `#173B2E` | Primary action fill |
| `--action-primary-hover` | `#0F2E23` | Primary action hover |
| `--action-on-primary` | `#FFFDF7` | Text on primary action |
| `--accent-marigold` | `#DCAF18` | Illustration and small highlights |
| `--accent-red` | `#B83D2A` | Tiny editorial accent; danger only when semantic |
| `--accent-river` | `#6F9BAA` | Illustration and informational accent |
| `--accent-indigo` | `#173D4A` | Evening illustration depth |
| `--accent-sage` | `#B8C8AE` | Positive and selected soft fill |

Contrast checks for the proposed light palette:

- Primary ink on canvas: `11.53:1`
- Muted ink on canvas: `5.63:1`
- Canvas text on primary action: `12.13:1`
- Red on canvas: `5.25:1`
- Informational blue on canvas: `6.39:1`

### 4.3 Dark palette

The generated boards define the light theme. Dark mode is a product adaptation, not an inverted illustration.

| Token | Value | Role |
|---|---:|---|
| `--paper-canvas` | `#111713` | Application background |
| `--paper-surface` | `#1B221D` | Cards, forms, drawers |
| `--paper-sunken` | `#232C25` | Quiet groups |
| `--ink-primary` | `#F4EFE3` | Headings and primary text |
| `--ink-body` | `#DED8CB` | Body text |
| `--ink-muted` | `#B4ADA0` | Metadata |
| `--line-soft` | `#39443B` | Borders |
| `--line-strong` | `#5A675D` | Selected boundaries |
| `--action-primary` | `#C9D8BE` | Primary action fill |
| `--action-primary-hover` | `#D9E5D1` | Primary action hover |
| `--action-on-primary` | `#132A20` | Text on primary action |

Do not automatically darken or invert editorial illustrations. Present them as printed artwork inside a bordered media frame. If artwork sits behind controls, use a single controlled overlay token and verify contrast per asset.

### 4.4 Mapping to the current app

The current runtime contract is retained during migration:

```css
:root {
  --bg: var(--paper-canvas);
  --bg-elevated: var(--paper-surface);
  --ink: var(--ink-primary);
  --ink-muted: var(--ink-muted);
  --border: var(--line-soft);
  --accent-button: var(--action-primary);
  --accent-ink: var(--action-on-primary);
}
```

Implementation note: avoid a self-referencing `--ink-muted` alias in the final CSS. Either keep the existing public token name as the canonical token or rename the foundation token during the migration. The snippet describes ownership, not final declaration order.

`--accent` remains the controlled trip-identity accent. Primary buttons must not become unreadable when the destination palette changes; `--accent-button` is therefore owned by the action system unless a tested recipe explicitly overrides it.

### 4.5 Semantic colours

Semantic feedback is separate from decorative travel colours.

| Meaning | Foreground | Soft background | Usage |
|---|---:|---:|---|
| Success / fits | `#4B7442` | `#E6EFE0` | Day fits, saved, live success |
| Information / source | `#2D6173` | `#E3EFF2` | Sources, neutral provider information |
| Warning / estimated | `#8A6100` | `#F5ECD1` | Estimated route, incomplete evidence |
| Danger / error | `#B83D2A` | `#F7E3DE` | Destructive actions and real errors only |
| Unknown | `#59665E` | `#EEEAE1` | Missing or unverified facts |

Never use red for neutral information, registration guidance, or decorative emphasis near forms.

## 5. Typography

The existing font pairing is retained:

- Display: `Instrument Serif`, fallback `Times New Roman`, serif
- Interface and body: `Instrument Sans`, fallback `Inter`, system UI, sans-serif

### 5.1 Type scale

| Style | CSS target | Use |
|---|---|---|
| Display | `clamp(3rem, 5vw, 4.5rem) / 0.98` | Rare cover or trip identity title |
| Page title | `clamp(2.25rem, 4vw, 3.75rem) / 1.02` | One per screen |
| Section title | `clamp(1.75rem, 2.5vw, 2.5rem) / 1.08` | Major page regions |
| Card title | `1.5rem / 1.2` | Current trip, place, activity |
| Body large | `1.125rem / 1.6` | Short introductions |
| Body | `1rem / 1.55` | Default copy |
| UI | `0.9375rem / 1.35` | Controls and labels |
| Metadata | `0.8125rem / 1.35` | Dates, duration, source status |
| Eyebrow | `0.75rem / 1.2`, `0.06em` tracking | Sparse category or state label |

### 5.2 Typography rules

- Use serif for page titles, card titles, place names, and expressive moments.
- Use sans-serif for controls, metadata, form labels, body copy, and status.
- Display serif remains regular weight. Do not simulate importance with bold serif.
- Keep body copy at `16px` minimum on mobile.
- Avoid all-caps paragraphs. Uppercase is limited to short metadata labels.
- Limit readable prose to approximately `62ch`.
- Use tabular numerals for times, dates, money, and itinerary metrics.

## 6. Spacing and layout

### 6.1 Spacing scale

Use a 4px base grid:

| Token | Value |
|---|---:|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-10` | `40px` |
| `--space-12` | `48px` |
| `--space-16` | `64px` |
| `--space-20` | `80px` |

Default component padding is `16–24px`. Major desktop regions use `32–48px`. Do not use large empty areas when a decision or fact needs proximity.

### 6.2 Responsive ranges

| Range | Width | Behaviour |
|---|---:|---|
| Compact | `0–639px` | One column, sheets, sticky actions |
| Medium | `640–1023px` | One column or balanced two-column forms |
| Desktop | `1024–1279px` | Primary split layouts |
| Wide | `1280px+` | Full top navigation and maximum content rail |

### 6.3 Application frame

- Maximum shell width: `1440px`
- Maximum reading/content width: `1280px`
- Compact gutter: `20px`
- Medium gutter: `32px`
- Desktop gutter: `40px`
- Wide gutter: `48px`
- Header height: `64px` compact, `72px` desktop
- Respect all Capacitor safe-area variables.

## 7. Shape, borders, and elevation

The generated system uses softly rounded rectangles, not a pill-first interface.

| Token | Value |
|---|---:|
| Page panel | `24px` |
| Section | `18px` |
| Card | `16px` |
| Compact card | `12px` |
| Media | `14px` |
| Modal / sheet | `20px` |
| Input | `10px` |
| Button | `8px` |
| Chip / segmented option | `8px` |
| Icon tile | Circle when semantic; `10px` otherwise |

Rules:

- Default border: `1px solid var(--line-soft)`.
- Selected controls use a stronger border and a soft fill, not a thick glow.
- Cards normally use no shadow or the low shadow below.
- Floating proposals, drawers, and sheets may use the floating shadow.

```css
--shadow-low: 0 1px 2px rgba(23, 59, 46, 0.04), 0 12px 28px -22px rgba(23, 59, 46, 0.22);
--shadow-floating: 0 18px 48px -24px rgba(17, 31, 24, 0.32);
```

This direction requires a new controlled adaptive recipe, provisionally named `editorial-journey`. Do not mutate every existing trip recipe into the same appearance. The global shell and core planning components use Editorial Journey; destination identity may still supply accent, motif, and imagery within that stable structure.

## 8. Illustration system

### 8.1 Visual grammar

- Flat gouache-like colour fields
- Screen-print or risograph grain
- Dry-brush edges and visible paper texture
- Fine graphite or charcoal detail lines
- Elevated, bird's-eye, or slightly isometric viewpoint
- Large landscapes containing tiny travellers, trains, buses, trams, or aircraft
- A route, road, river, railway, or footpath as the main compositional gesture
- Marigold, forest green, mineral blue, warm cream, charcoal, and occasional red
- Generous negative space and calm narrative scale

### 8.2 Illustration roles

| Role | Typical placement | Rule |
|---|---|---|
| Journey hero | Current trip and trip setup | One dominant route-led scene |
| Editorial card | Discovery introduction or fictional example | Never presented as a real venue photograph |
| Day narrative | Itinerary sidebar or day header | Supports the route; does not replace the schedule |
| Empty state | No trips, no shortlist, no results | Small and quiet; action remains dominant |
| Line motif | Header clouds, train line, plants | Decorative only; low opacity and no interaction |

### 8.3 Density and placement

- Use no more than one dominant illustration in the first viewport.
- Desktop art may occupy `35–55%` of a split screen.
- Mobile art normally occupies `25–40%` of the initial viewport.
- Do not place paragraph text over detailed artwork.
- Do not place persistent controls over art unless contrast is proven for every crop.
- Line motifs use `8–18%` opacity and must disappear before they add clutter.

### 8.4 Responsive art direction

- Store a landscape and portrait crop when the focal path cannot survive centre-cropping.
- Use `<picture>` or equivalent source selection instead of CSS background images for meaningful responsive art.
- Record a focal point with each asset.
- Use `object-fit: cover` only after verifying both compact and wide crops.
- Decorative artwork uses empty alt text. Narrative artwork gets concise alt text describing only what the image contributes.

### 8.5 Production format

- Keep the approved PNG master outside the shipped bundle.
- Ship AVIF where supported with WebP fallback.
- Include intrinsic width and height to prevent layout shift.
- Target hero assets below `250 KB` when acceptable without visible print-texture damage.
- Do not blur or denoise away the intended grain.

## 9. Navigation

### 9.1 Global navigation

Keep the global level quiet:

- Planitenary wordmark
- My Trips
- Discover when it has a clear planning purpose
- Profile and settings

Do not make every handbook tool a global destination.

### 9.2 Active-trip navigation

Primary destinations:

- Itinerary
- Map
- More

Budget, checklist, documents, photos, and settings live under More unless usage evidence justifies elevation.

Ask Planitenary is contextual. It opens from the trip or day being discussed and receives that context. It is not a permanent floating brand mascot.

### 9.3 Compact navigation

- Use the small top app bar shown in the boards.
- Keep the active-trip bottom navigation to three or four destinations.
- Respect `--app-safe-bottom`.
- More opens a sheet, not a dense miniature desktop menu.

## 10. Core component specifications

### 10.1 App bar

- Cream or theme surface with one bottom divider.
- Small serif wordmark at the left.
- Desktop navigation remains compact and centred or right-aligned.
- Mobile uses one menu trigger with a minimum `44 × 44px` target.
- Do not apply glass blur by default.

### 10.2 Page header

- One serif page title.
- Optional one-line explanation or date/status row.
- Optional light line motif in otherwise unused space.
- Primary action belongs near the relevant content, not automatically in the header.

### 10.3 Buttons

| Variant | Appearance | Use |
|---|---|---|
| Primary | Evergreen fill, cream text | One main action per region |
| Secondary | Paper fill, strong border | Alternative or review action |
| Tertiary | Text/icon only | Back, dismiss, low-emphasis actions |
| Danger | Danger text or fill after confirmation | Destructive actions only |

Rules:

- Minimum height: `44px`; preferred primary height: `48px`.
- Default radius: `8px`, not a full pill.
- Use sentence case and a direct verb.
- Arrows indicate forward navigation, not every action.
- Disabled state must retain readable text and explain the blocker nearby.

### 10.4 Form controls

- Labels remain outside fields.
- Input height: `48px` minimum.
- Use a paper surface, 1px border, and `10px` radius.
- Selected segmented choices use evergreen fill or a strong border with soft sage fill.
- Optional fields are labelled optional; required fields are not decorated with repeated asterisks.
- Error copy is specific, adjacent, and red only for a real error.

### 10.5 Current trip hero

Desktop anatomy:

1. Current-trip eyebrow and status dot
2. Trip title
3. Duration and dates
4. Continue action
5. Landscape illustration occupying approximately half the card

Mobile stacks text above art. The current trip remains the first item. Previous trips become compact rows rather than equal competing cards.

### 10.6 Trip row

- Optional thumbnail
- Trip title
- Duration and date
- Single disclosure affordance
- Rename, archive, and delete live in an overflow menu
- Entire row is keyboard and pointer actionable without nesting conflicting buttons

### 10.7 Discovery card

Required anatomy:

1. Authentic place photo in production
2. Place name and concise match reason
3. Opening status, visit duration, and cost when known
4. Source count and checked date
5. Skip, Maybe, and Keep actions

The illustration shown in the concept board demonstrates composition only. Production place identity remains photographic and source-grounded.

### 10.8 Evidence link and source drawer

- Use wording such as `2 sources · checked today`.
- The link sits beside the fact group it supports.
- The drawer shows publisher, excerpt, date, authority, and the exact supported claim.
- Source access remains available without flipping a card.
- Unknown or conflicting evidence is shown, not suppressed.

### 10.9 Itinerary timeline

- Time occupies a stable narrow column.
- A continuous vertical rule communicates sequence.
- Activity markers use semantic icon tiles.
- Travel, queue, buffer, meal, and rest appear as connectors between activities.
- Place titles use serif; operational information uses sans-serif.
- Source and opening status appear only where relevant.
- Editing preserves time and route context instead of opening an unrelated form.

### 10.10 Day-fit status

- Positive: `This day fits` with icon and text.
- Warning: name the exact constraint, such as `Transfer may be 18 minutes too tight`.
- Never rely on colour alone.
- Do not show an unexplained numeric score.

### 10.11 AI proposal card

Required anatomy:

1. Plain-language requested outcome
2. Number and summary of proposed changes
3. Review action
4. Dismiss action
5. Apply only inside the review flow

AI never silently writes to the itinerary. After applying, show an undo route and retain the change history.

### 10.12 Drawers and sheets

- Desktop: right-edge, full-height drawer, maximum width appropriate to content.
- Compact: full-height or large bottom sheet with safe-area padding.
- Header and footer remain fixed only when the middle region scrolls independently.
- Background scroll is locked.
- The established panel transition is `420ms` with easing `[0.16, 1, 0.3, 1]`.

## 11. Screen composition contracts

### 11.1 My Trips

Desktop:

- Current-trip hero first
- Illustration and trip details share one card
- Previous trips use full-width compact rows
- New trip is a clear final action, not an advertisement

Mobile:

- Title, current trip, previous trips, new-trip action
- Current-trip artwork uses a portrait-specific crop
- Destructive trip actions remain behind overflow

### 11.2 Plan a Trip

Desktop:

- Form column: approximately `5/12`
- Illustration column: approximately `7/12`
- Summary and primary action remain in the form column

Mobile:

- Short introduction
- Compact narrative illustration
- Destination, dates, pace, interests, optional budget
- Sticky or strongly anchored Build action
- Advanced constraints expand only when requested

### 11.3 Choose Places

Desktop:

- Discovery card: approximately `7/12`
- Shortlist: approximately `5/12`
- Build action stays with the shortlist

Mobile:

- One discovery card at a time
- Actions stay within thumb reach
- Kept-place summary becomes a compact bottom bar or sheet trigger
- Evidence opens in a sheet

### 11.4 Day Plan

Desktop:

- Timeline: approximately `8/12`
- Route illustration or map: approximately `4/12`
- AI proposal appears near the affected part of the timeline

Mobile:

- Timeline is the primary content
- Day selector remains horizontally usable
- Map, evidence, and AI use focused sheets
- Route illustration may become a short header crop or disappear when it competes with the schedule

## 12. Motion

| Token | Duration | Use |
|---|---:|---|
| Instant | `120ms` | Press and small state feedback |
| Fast | `180ms` | Tabs, chips, hover/focus transitions |
| Standard | `240ms` | Card and content transitions |
| Panel | `420ms` | Drawers and sheets |
| Narrative | `600ms` | One-time route or illustration reveal |

Preferred easing:

- Entrance and panel: `[0.16, 1, 0.3, 1]`
- Small state change: `ease-out`

Rules:

- No continuously looping decorative motion.
- Artwork may reveal once through a short mask or route-line draw.
- Hover lift is at most `1–2px`.
- Respect `prefers-reduced-motion`; reduce transforms and set narrative motion to near-instant.
- Motion must never delay access to the itinerary or controls.

## 13. Content and voice

Planitenary speaks plainly and specifically.

Preferred:

- `Plan a trip`
- `Build my first draft`
- `Continue planning`
- `This day fits`
- `Travel time is estimated`
- `2 sources · checked today`
- `Preview 2 changes`

Avoid:

- `Unlock your dream journey`
- `AI-powered travel, reimagined`
- `The ultimate travel companion`
- `100% verified`
- `Perfect itinerary`

Use `we` sparingly. Tell the traveller what will happen, what is known, and what remains uncertain.

## 14. Accessibility contract

- Text contrast: WCAG AA minimum `4.5:1`; large text `3:1`.
- Interactive component boundaries and focus indicators: `3:1` against adjacent colours.
- Minimum pointer target: `44 × 44px`.
- Visible focus ring: at least `2px` with offset.
- Never communicate status using colour alone.
- Preserve logical heading order.
- Drawers and sheets trap focus, close with Escape, and restore focus to their trigger.
- Timeline order must remain meaningful without the visual line.
- Decorative illustrations use `alt=""`; meaningful illustrations receive concise alt text.
- Do not place essential copy inside generated images.
- Support text zoom to `200%` and browser zoom to `400%` without losing actions.

## 15. Implementation contract

### 15.1 Reuse before replacement

Extend the existing semantic component layer:

- `AdaptiveSurface`
- `AdaptiveButton`
- `AdaptiveChip`
- `AdaptiveTab`
- `AdaptiveInput`
- `AdaptiveMediaFrame`
- `AdaptiveIconTile`
- `AdaptiveBadge`
- `AdaptiveModal`

Add product patterns on top of these primitives. Do not create page-specific button, input, or card systems.

### 15.2 New recipe

Add an `editorial-journey` recipe or equivalent stable core recipe with:

- Soft rectangular controls
- Spacious but useful density
- 1px paper-toned borders
- Low shadows
- Regular serif headings
- Gentle motion
- Line-drawing motif support
- Illustration-forward media treatment

The existing `quiet-editorial` recipe is the nearest starting point, but its pill-shaped controls and larger card radii do not match the approved boards and should not be adopted unchanged.

### 15.3 No uncontrolled styling

- New components consume semantic CSS variables.
- Do not add raw `slate`, `rose`, `blue`, `emerald`, or `white` utility colours to redesigned surfaces.
- Do not use CSS gradients as a substitute for missing illustrations.
- Do not place global overrides around legacy pages unless the selector is scoped and migration-safe.
- Protect auth, error, Supabase, and persistence behaviour while changing presentation.

### 15.4 Verification for each migrated screen

1. Focused component tests
2. TypeScript and production build
3. `git diff --check`
4. Desktop browser acceptance
5. Compact browser acceptance
6. Keyboard-only pass
7. Reduced-motion pass
8. Light and dark theme pass
9. Real place-photo identity and credit check where applicable
10. Provider/source status check for live, estimated, partial, and unknown states

Browser acceptance does not substitute for native-device validation. Native safe areas, keyboard behaviour, sheets, and scroll containment require separate device testing before release.

## 16. Migration sequence

### Phase 1 — Foundations

- Add Editorial Journey semantic tokens and recipe.
- Add illustration frame, line motif, and responsive picture primitives.
- Update Button, Card, input, tabs, focus, and status primitives.
- Keep behaviour unchanged.

### Phase 2 — My Trips and trip creation

- Redesign `TripDashboard`.
- Simplify the trip-creation flow visually without removing required data.
- Integrate the approved bus and train illustration families.

### Phase 3 — Discovery

- Redesign the discovery deck, shortlist, source link, and compact actions.
- Preserve preference-first discovery, fallback provenance, real media, and place identity.

### Phase 4 — Itinerary and contextual AI

- Redesign the day timeline and route connectors.
- Add fit status and contextual proposal cards.
- Preserve review-before-apply, undo, evidence, and change history.

### Phase 5 — Secondary handbook tools

- Move secondary destinations under a quiet More structure.
- Migrate budget, checklist, documents, photos, profile, and settings to the same primitives.
- Do not force decorative illustrations onto utility-heavy screens.

### Phase 6 — Consolidation

- Remove superseded legacy style bridges only after all consumers migrate.
- Audit raw colours, duplicate radii, one-off shadows, and legacy pill controls.
- Run full responsive, browser, native, and accessibility acceptance.

## 17. Definition of done

A redesigned screen belongs to this system when:

- It looks related to all five approved boards without copying a screenshot literally.
- It uses semantic tokens and shared primitives.
- It has one obvious primary action.
- It remains useful without its illustration.
- Its illustration does not make a factual place claim.
- Sources, uncertainty, route status, and AI proposals remain honest.
- Desktop and mobile compositions are intentionally designed.
- Keyboard, focus, reduced motion, zoom, and safe areas work.
- Existing data, auth, persistence, and proposal safeguards remain intact.

## 18. Decision summary

The Planitenary redesign is a **quiet editorial journey planner**:

- Cream paper interface
- Evergreen type and actions
- Marigold, mineral blue, and deep green travel illustrations
- Serif place and trip names
- Sans-serif operational facts
- Soft rectangular controls
- Thin borders and restrained elevation
- One narrative illustration per major screen
- Real photographs for real places
- Contextual, reviewable AI
- Evidence visible where trust matters

This is the visual and behavioural contract for the forthcoming whole-app redesign.
