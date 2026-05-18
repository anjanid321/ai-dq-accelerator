# Figma Tokens Snapshot — 2026-05-15

Authoritative variable values from the approved Foundation shells. Pulled via `get_variable_defs` + a full collection dump immediately after Task 3.3 approval. Use these to scaffold Phase 4 code (theme files, globals.css, Tailwind config).

Source file: `https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx/DQ-Accelerator`

> **2026-05-17 update:** the second brand was swapped from the Tractor Supply demo stub to a real client, Clayton Homes. Hex values below reflect the Clayton swap. UDig remains the default brand.

## Brand collection — per-mode values

| Token | UDig | Clayton Homes |
|---|---|---|
| `color/brand/primary` | `#FF8200` | `#0071C8` |
| `color/brand/accent` | `#002B40` | `#022D4D` |
| `color/brand/on-primary` | `#FFFFFF` | `#FFFFFF` |

These three are the only Brand-collection variables. Everything else is mode-less (System).

Clayton values are pulled from the *Sincerely Clayton* brand guide (Oct 2025) — Clayton Blue (`#0071C8`) is the headline accent in the Cool Tone family, Navy (`#022D4D`) is the dark chrome. White on Clayton Blue clears AA at ~5.1:1; the navy is reserved for primary CTAs (>15:1) per the same accessibility rule we applied to UDig.

## System collection — single Default mode

### Background
- `color/bg/canvas` `#F8FAFC`
- `color/bg/surface` `#FFFFFF`
- `color/bg/elevated` `#F1F5F9`

### Foreground
- `color/fg/default` `#0F172A`
- `color/fg/muted` `#475569`
- `color/fg/subtle` `#94A3B8`
- `color/fg/inverse` `#FFFFFF`

### Border
- `color/border/subtle` `#E2E8F0`
- `color/border/strong` `#CBD5E1`

### Semantic (decorative — borders, dots, icons, fills)
- `color/semantic/success` `#22C55E`
- `color/semantic/warning` `#F59E0B`
- `color/semantic/danger` `#EF4444`
- `color/semantic/info` `#3B82F6`

### Semantic deep (text on white surfaces — pass AA)
- `color/semantic/success-deep` `#15803D`
- `color/semantic/warning-deep` `#B45309`
- `color/semantic/danger-deep` `#B91C1C`
- `color/semantic/info-deep` `#1D4ED8`

### Accent (AI event types)
- `color/accent/purple` `#9333EA` — thinking events
- `color/accent/purple-deep` `#6B21A8` — thinking text
- `color/accent/indigo` `#6366F1` — tool-call events
- `color/accent/indigo-deep` `#3730A3` — tool-call text

### Spacing (px, FLOAT)
`space/{2,4,6,8,12,16,20,24,32,40,48,64}` = identity (e.g. `space/12` = 12)

### Radius (px, FLOAT)
- `radius/sm` `4`
- `radius/md` `8`
- `radius/lg` `12`
- `radius/full` `9999`

## Theme TS shape (Task 4.2)

Only the three Brand variables are theme-scoped. Everything else stays at `:root` in globals.css.

```ts
export type Theme = {
  id: string;
  name: string;
  brand: {
    primary: string;
    accent: string;
    onPrimary: string;
  };
  logo: {
    src: string;       // path to SVG asset
    alt: string;
    width: number;
    height: number;
  };
  favicon?: string;
};
```

## Component-level decisions worth preserving in code

- **Primary Button** fill is `brand/accent` (NOT `brand/primary`). Original orange/red fill failed WCAG AA against white text (~2.5:1 UDig, ~4.0:1 TS). Navy/black gives >15:1.
- **StepperItem** circles are 18px. Inner content:
  - `done`: 18px green (`semantic/success`) circle + small white SVG checkmark (size from approved Figma — pull at translation time).
  - `active`: 18px orange (`brand/primary`) circle + 6px white inner dot.
  - `locked`: 18px gray (`border/strong`) circle + 4px `fg/subtle` inner dot. NO lock glyph.
  - `default` (unused): empty 18px circle with `border/strong` outline.
- **WaitingBanner** has `layoutAlign=STRETCH` — instances fill their auto-layout parent's width. Visually a rounded pill (`radius/md` = 8px) with `bg/elevated` fill and `border/subtle` border.
- **AI cards** (Tool/Result/Thinking/Done × highlighted/not): all have `primaryAxisSizingMode=AUTO` + `layoutSizingVertical=HUG`. Width fixed at 316px (panel inner width = 340 − 24 padding).
- **TopBar** is 56px tall: Logo → "DQ Accelerator" 14px Semi Bold → 1px vertical separator → `← Sessions` → `/` → filename → metadata → flex → ScoreChip → `⋯`.
