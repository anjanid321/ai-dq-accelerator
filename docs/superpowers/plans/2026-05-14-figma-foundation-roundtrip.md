# Figma Foundation Round-Trip (Round 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the design-system foundation for the DQ Accelerator workspace: draft tokens + workspace shell in Figma (UDig-branded + Tractor-Supply-themed variant), then translate the approved design back into code as a swappable theming system. No stage screens change in this round — only the chrome (TopBar, Stepper, AIPanel) and the token / theme plumbing underneath.

**Architecture:** Two sequential phases. **Figma drafting phase** uses the `use_figma` MCP tool to programmatically build a `Brand` variable collection with two modes (UDig, Tractor Supply), system variable collections (Type, Space, Radius, Elevation, Semantic), shell-relevant components, and a workspace shell frame shown in both brand modes side-by-side. Human review/approval gates between Figma pages. **Code translation phase** introduces a `lib/theme/` module that resolves the active theme from `?client=` URL param → `NEXT_PUBLIC_CLIENT` env var → `udig` default, writes the resolved tokens as CSS variables on `:root` via a `<ThemeProvider>` client component, and rewires `tailwind.config.ts` so existing utility classes (`bg-surface`, `border-border`, etc.) resolve via `var(--…)`. The three shell component files (`TopBar.tsx`, `Stepper.tsx`, `AIPanel.tsx`) are edited to remove hard-coded hex values and consume tokens. Stage component files are not touched in this round; they inherit the new colors through the rewired Tailwind config.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind 3.4, Jest + Testing Library, Figma Plugin API via `mcp__figma__use_figma`.

**Reference spec:** `docs/superpowers/specs/2026-05-14-figma-roundtrip-redesign-design.md`.

**Critical Next.js 16 note:** `frontend/AGENTS.md` warns that Next 16 has breaking changes from earlier majors. Before touching `app/layout.tsx` or anything router-adjacent, consult `frontend/node_modules/next/dist/docs/` (after install) to verify current API for client components, metadata, and root layout patterns. Do not assume Next 14/15 conventions.

---

## File Structure

**New files (frontend):**

```
frontend/lib/theme/
  types.ts               ─ Theme TS type — single source of truth for token shape
  apply.ts               ─ writeTokensToRoot(theme): writes CSS vars to :root
  resolve.ts             ─ getActiveTheme(): URL param → env var → default
  themes/
    udig.ts              ─ UDig brand values (default theme)
    tractor-supply.ts    ─ Tractor Supply stub theme
    _registry.ts         ─ { udig, 'tractor-supply' } map; default export = udig

frontend/components/theme/
  ThemeProvider.tsx      ─ Client component; resolves theme + writes tokens on mount/change
  Logo.tsx               ─ Renders theme.logo

frontend/public/logos/
  udig.svg               ─ UDig wordmark
  tractor-supply.svg     ─ Tractor Supply placeholder mark
```

**Modified files (frontend):**

```
app/layout.tsx                          ─ Wrap body in <ThemeProvider>, add data-theme attr
app/globals.css                         ─ Replace 2 ad-hoc vars with full :root token set
tailwind.config.ts                      ─ Map all color/space/radius/font entries to var(--…)
components/workspace/TopBar.tsx         ─ Drop inline hex gradient, use <Logo />, semantic score chip
components/workspace/Stepper.tsx        ─ Replace bg-indigo and #6366f1 shadow with brand tokens; add sub-status slot
components/ai-panel/AIPanel.tsx         ─ Token-driven segmented control, semantic status dot
```

**New files (tests):**

```
__tests__/lib/theme/
  resolve.test.ts        ─ URL > env > default precedence
  apply.test.ts          ─ Writes CSS vars to documentElement.style
__tests__/components/theme/
  ThemeProvider.test.tsx ─ Renders children, sets data-theme, calls apply
  Logo.test.tsx          ─ Renders correct src/alt from theme
__tests__/components/workspace/
  TopBar.test.tsx        ─ Score chip variant selection from semantic threshold
```

**Figma file structure** (created by Phase 1–3 tasks):

```
00 — Tokens
01 — Components
02 — Foundation
99 — Archive
```

`fileKey = gsnW43uSpvdLpwandZM8Zx`. Plan operations target this file.

---

## Phase 0 — Prep & recon

### Task 0.1: Verify worktree dependencies

**Files:** none (environment check)

- [ ] **Step 1: Check `frontend/` has installed dependencies**

Run from repo root:
```bash
ls frontend/node_modules/next/package.json
```
Expected: file exists.

If it doesn't exist (worktree was created without install), run:
```bash
cd frontend && npm install
```
Expected: install completes without errors. May take 1–3 min.

- [ ] **Step 2: Verify Next.js version**

```bash
node -p "require('./frontend/node_modules/next/package.json').version"
```
Expected: `16.x.x`. If it's not 16, stop and ask — the plan assumes Next 16.

- [ ] **Step 3: Verify dev server starts cleanly**

```bash
cd frontend && npm run dev
```
Expected: server starts on `http://localhost:3000` (or whatever port is in use). Visit `/sessions` and confirm the page loads.

Stop the dev server (`Ctrl+C`) after confirming.

- [ ] **Step 4: Confirm no uncommitted changes**

```bash
git status
```
Expected: working tree clean. If not, stop and ask before proceeding.

### Task 0.2: Read Next.js 16 root-layout and client-component docs

**Files:** none (read-only research)

- [ ] **Step 1: Read root-layout docs**

```bash
find frontend/node_modules/next/dist -path '*docs*' -name '*layout*' 2>/dev/null | head -10
```

Read the most relevant file(s) on root layouts in Next 16. Things to verify:
- How `<html>` / `<body>` rendering works in Next 16 root layout.
- Whether `'use client'` is required on the root layout (it should not be).
- How to set `data-*` attributes on `<html>` for theming (server-side preferred).

- [ ] **Step 2: Read client-component / hydration docs**

```bash
find frontend/node_modules/next/dist -path '*docs*' -name '*client*' 2>/dev/null | head -10
```

Verify the pattern for a client-only `<ThemeProvider>` wrapping `{children}` without breaking SSR.

- [ ] **Step 3: Note any version-specific gotchas**

Write a short note (in your own working memory, not the codebase) of any Next 16 differences from Next 14/15 you spot — especially around `useSearchParams`, `headers()`, and metadata. These matter for `resolve.ts`.

### Task 0.3: Recon authoritative UDig brand assets

**Files:** none (research)

- [ ] **Step 1: Pull UDig brand tokens from `anthropic-skills:udig-deck` skill**

Invoke the `anthropic-skills:udig-deck` skill and read its template. Note:
- Primary color hex
- Accent color hex
- Typography (display font, body font, weights)
- Logo file location

- [ ] **Step 2: If brand assets are partial or missing, ask the user**

Show what you found and the gaps. Ask for hex values, font names, and logo SVG path. Do not invent UDig brand values. Do not proceed past this step without confirmed values.

- [ ] **Step 3: Locate or request the UDig logo SVG**

Find the UDig logo SVG. If not available in the skill, ask the user for the file. Save the eventual location for Phase 4.

- [ ] **Step 4: Decide Tractor Supply stub colors**

Tractor Supply's public brand: red `#D62828` (approx), white, dark grey. Use these as stub values — they're for demoing the swap mechanic, not an actual Tractor Supply engagement. Confirm with user that stub Tractor Supply branding is fine, or if they want a different second client for the demo.

---

## Phase 1 — Figma: Tokens page

### Task 1.1: Create page skeleton and variable collections

**Files:** Figma file `gsnW43uSpvdLpwandZM8Zx` (no codebase files)

- [ ] **Step 1: Rename existing empty page and create new pages**

Run via `mcp__figma__use_figma`:

```js
// description: "Rename Page 1 and create 00 Tokens, 01 Components, 02 Foundation, 99 Archive"
const existing = figma.root.children[0];
existing.name = '00 — Tokens';
const components = figma.createPage(); components.name = '01 — Components';
const foundation = figma.createPage(); foundation.name = '02 — Foundation';
const archive = figma.createPage(); archive.name = '99 — Archive';
return { pages: figma.root.children.map(p => ({ id: p.id, name: p.name })) };
```

Expected return: 4 pages in order.

- [ ] **Step 2: Create variable collections with modes**

```js
// description: "Create Brand collection with UDig + Tractor Supply modes; create System collections"
const brand = figma.variables.createVariableCollection('Brand');
brand.renameMode(brand.modes[0].modeId, 'UDig');
const tsMode = brand.addMode('Tractor Supply');

const system = figma.variables.createVariableCollection('System');
// keep default single mode named "Default"
system.renameMode(system.modes[0].modeId, 'Default');

return {
  brand: { id: brand.id, modes: brand.modes },
  system: { id: system.id, modes: system.modes },
};
```

Save the returned `brand.id`, `tsMode` modeId, `system.id` — they're referenced in subsequent steps.

- [ ] **Step 3: Create Brand color variables in both modes**

Use UDig brand values from Task 0.3 and Tractor Supply stub values. Replace placeholder hex below with actual values pulled in Task 0.3.

```js
// description: "Create Brand color variables with values for UDig and Tractor Supply modes"
const brand = figma.variables.getVariableCollectionById('<BRAND_COLLECTION_ID>');
const udigMode = brand.modes[0].modeId;
const tsMode   = brand.modes[1].modeId;

const hex = (h) => {
  const n = parseInt(h.replace('#',''), 16);
  return { r: ((n>>16)&255)/255, g: ((n>>8)&255)/255, b: (n&255)/255 };
};

function makeColor(name, udigHex, tsHex) {
  const v = figma.variables.createVariable(name, brand, 'COLOR');
  v.setValueForMode(udigMode, hex(udigHex));
  v.setValueForMode(tsMode,   hex(tsHex));
  return v;
}

const created = {
  primary:    makeColor('color/brand/primary',     '<UDIG_PRIMARY_HEX>',     '#D62828'),
  accent:     makeColor('color/brand/accent',      '<UDIG_ACCENT_HEX>',      '#1A1A1A'),
  onPrimary:  makeColor('color/brand/on-primary',  '#FFFFFF',                '#FFFFFF'),
};
return { ids: Object.fromEntries(Object.entries(created).map(([k,v])=>[k, v.id])) };
```

- [ ] **Step 4: Create System color variables (single mode)**

```js
// description: "Create System color variables (surfaces, fg, borders, semantic)"
const sys = figma.variables.getVariableCollectionById('<SYSTEM_COLLECTION_ID>');
const m = sys.modes[0].modeId;
const hex = (h) => { const n = parseInt(h.replace('#',''),16); return { r:((n>>16)&255)/255, g:((n>>8)&255)/255, b:(n&255)/255 }; };

function mk(name, val) {
  const v = figma.variables.createVariable(name, sys, 'COLOR');
  v.setValueForMode(m, hex(val));
  return v;
}

// Light, clean defaults — same as current Tailwind config but renamed for clarity
mk('color/bg/canvas',          '#F8FAFC');
mk('color/bg/surface',         '#FFFFFF');
mk('color/bg/elevated',        '#F1F5F9');
mk('color/fg/default',         '#0F172A');
mk('color/fg/muted',           '#475569');
mk('color/fg/subtle',          '#94A3B8');
mk('color/fg/inverse',         '#FFFFFF');
mk('color/border/subtle',      '#E2E8F0');
mk('color/border/strong',      '#CBD5E1');
mk('color/semantic/success',   '#22C55E');
mk('color/semantic/warning',   '#F59E0B');
mk('color/semantic/danger',    '#EF4444');
mk('color/semantic/info',      '#3B82F6');
return 'ok';
```

- [ ] **Step 5: Create System numeric variables (spacing, radius)**

```js
// description: "Create System spacing and radius variables"
const sys = figma.variables.getVariableCollectionById('<SYSTEM_COLLECTION_ID>');
const m = sys.modes[0].modeId;

function mk(name, val, type='FLOAT') {
  const v = figma.variables.createVariable(name, sys, type);
  v.setValueForMode(m, val);
  return v;
}

// spacing (4px step)
[2,4,6,8,12,16,20,24,32,40,48,64].forEach(n => mk(`space/${n}`, n));
// radius
mk('radius/sm', 4);
mk('radius/md', 8);
mk('radius/lg', 12);
mk('radius/full', 9999);
return 'ok';
```

### Task 1.2: Draw tokens reference frames on `00 — Tokens`

**Files:** Figma file (no codebase files)

- [ ] **Step 1: Add color ramp section (UDig mode and Tractor Supply mode side-by-side)**

```js
// description: "Draw color ramp swatches for both Brand modes on Tokens page"
const tokens = figma.root.children.find(p => p.name === '00 — Tokens');
await figma.setCurrentPageAsync(tokens);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

// Create a section frame "Brand colors — side-by-side"
const section = figma.createFrame();
section.name = 'Brand colors';
section.layoutMode = 'HORIZONTAL';
section.itemSpacing = 48;
section.paddingTop = 32; section.paddingBottom = 32;
section.paddingLeft = 32; section.paddingRight = 32;
section.x = 0; section.y = 0;
section.fills = []; // transparent

// For each Brand mode (UDig, Tractor Supply), build a column of swatches
const brand = figma.variables.getLocalVariableCollections().find(c => c.name === 'Brand');
for (const mode of brand.modes) {
  const col = figma.createFrame();
  col.name = mode.name;
  col.layoutMode = 'VERTICAL';
  col.itemSpacing = 12;
  col.fills = [];
  col.explicitVariableModes = { [brand.id]: mode.modeId };

  // header
  const label = figma.createText();
  label.fontName = { family: 'Inter', style: 'Semi Bold' };
  label.characters = mode.name;
  label.fontSize = 16;
  col.appendChild(label);

  // 3 brand swatches (primary, accent, on-primary)
  for (const key of ['primary','accent','on-primary']) {
    const v = figma.variables.getLocalVariables('COLOR').find(x => x.name === `color/brand/${key}`);
    const sw = figma.createFrame();
    sw.name = `brand/${key}`;
    sw.resize(160, 56);
    sw.cornerRadius = 8;
    sw.fills = [figma.variables.setBoundVariableForPaint({ type:'SOLID', color:{r:0,g:0,b:0} }, 'color', v)];
    col.appendChild(sw);
  }

  section.appendChild(col);
}
return { sectionId: section.id };
```

- [ ] **Step 2: Add system color row beneath**

```js
// description: "Add system color swatches row below brand colors"
const tokens = figma.root.children.find(p => p.name === '00 — Tokens');
await figma.setCurrentPageAsync(tokens);
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

const row = figma.createFrame();
row.name = 'System colors';
row.layoutMode = 'HORIZONTAL';
row.itemSpacing = 12;
row.paddingTop = 32; row.paddingLeft = 32;
row.y = 220;
row.fills = [];

const sys = figma.variables.getLocalVariables('COLOR').filter(v => v.name.startsWith('color/bg/') || v.name.startsWith('color/fg/') || v.name.startsWith('color/border/') || v.name.startsWith('color/semantic/'));
for (const v of sys) {
  const sw = figma.createFrame();
  sw.name = v.name;
  sw.resize(120, 56);
  sw.cornerRadius = 8;
  sw.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v)];
  row.appendChild(sw);
}
return 'ok';
```

- [ ] **Step 3: Add type specimen**

```js
// description: "Add Inter type specimen with sizes 12/14/16/18/24/32/48"
const tokens = figma.root.children.find(p => p.name === '00 — Tokens');
await figma.setCurrentPageAsync(tokens);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

const block = figma.createFrame();
block.name = 'Type specimen';
block.layoutMode = 'VERTICAL';
block.itemSpacing = 8;
block.paddingLeft = 32; block.paddingTop = 32;
block.y = 360;
block.fills = [];

for (const size of [12,14,16,18,24,32,48]) {
  const t = figma.createText();
  t.fontName = { family: 'Inter', style: 'Regular' };
  t.fontSize = size;
  t.characters = `${size}px — The quick brown fox`;
  block.appendChild(t);
}
return 'ok';
```

- [ ] **Step 4: Take screenshot for review**

```js
// Use get_screenshot on the 00 — Tokens page
```

Run the `mcp__figma__get_screenshot` tool with the Tokens page nodeId. Save the screenshot URL.

### Task 1.3: User review gate — Tokens page

**Files:** none (human gate)

- [ ] **Step 1: Present screenshot + Figma link to user**

Message the user with: the screenshot URL, a direct Figma link (`https://www.figma.com/design/gsnW43uSpvdLpwandZM8Zx/?node-id=<00_tokens_node_id>`), and a one-paragraph summary of what's on the page (brand swatches in both modes, system swatches, type specimen).

- [ ] **Step 2: Wait for user feedback or approval**

If user requests changes, iterate by re-running `use_figma` calls. Bump version naming if frames are recreated (`Brand colors v2`). Move superseded frames to page `99 — Archive` instead of deleting.

- [ ] **Step 3: Wait for explicit "approved" before proceeding to Phase 2**

Do not advance to Task 2.1 until user says approved.

---

## Phase 2 — Figma: Components page

### Task 2.1: Build shell-relevant components

**Files:** Figma file (no codebase files)

For each component below, build it as a Figma component (not just a frame). All fills/strokes that represent color should bind to variables (no hardcoded hex). Only build what the shell needs — defer Button/Input/Card to the first stage that actually needs them (YAGNI).

- [ ] **Step 1: Build `Stepper Item` component**

```js
// description: "Build Stepper Item component with default/active/done/locked variants"
const page = figma.root.children.find(p => p.name === '01 — Components');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

// Helper to fetch a variable
const v = (name) => figma.variables.getLocalVariables('COLOR').find(x => x.name === name);

function makeItem(state) {
  const f = figma.createFrame();
  f.name = `state=${state}`;
  f.layoutMode = 'HORIZONTAL';
  f.itemSpacing = 8;
  f.paddingTop = 6; f.paddingBottom = 6; f.paddingLeft = 8; f.paddingRight = 8;
  f.cornerRadius = 8;
  f.fills = [];
  f.primaryAxisAlignItems = 'CENTER';
  f.counterAxisAlignItems = 'CENTER';

  // dot
  const dot = figma.createEllipse();
  dot.resize(8, 8);
  const dotColor = state === 'done' ? v('color/semantic/success')
                 : state === 'active' ? v('color/brand/primary')
                 : v('color/border/strong');
  dot.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', dotColor)];

  const t = figma.createText();
  t.characters = 'Profile';
  t.fontSize = 12;
  t.fontName = { family: 'Inter', style: state === 'active' ? 'Semi Bold' : 'Regular' };
  const labelColor = state === 'locked' ? v('color/fg/subtle') : state === 'done' ? v('color/fg/muted') : v('color/fg/default');
  t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', labelColor)];

  f.appendChild(dot);
  f.appendChild(t);
  return f;
}

const variants = ['default','active','done','locked'].map(makeItem);
const component = figma.combineAsVariants(variants, page);
component.name = 'StepperItem';
return { id: component.id };
```

- [ ] **Step 2: Build `Score Chip` component with variants**

```js
// description: "Build Score Chip component (success/warning/danger variants)"
const page = figma.root.children.find(p => p.name === '01 — Components');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

const v = (name) => figma.variables.getLocalVariables('COLOR').find(x => x.name === name);

function chip(variant, label) {
  const semantic = v(`color/semantic/${variant}`);
  const f = figma.createFrame();
  f.name = `variant=${variant}`;
  f.layoutMode = 'HORIZONTAL';
  f.itemSpacing = 4;
  f.paddingTop = 2; f.paddingBottom = 2; f.paddingLeft = 10; f.paddingRight = 10;
  f.cornerRadius = 9999;
  f.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}, opacity:0.10}, 'color', semantic)];
  f.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}, opacity:0.4}, 'color', semantic)];

  const t = figma.createText();
  t.characters = label;
  t.fontSize = 12;
  t.fontName = { family: 'Inter', style: 'Semi Bold' };
  t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', semantic)];

  f.appendChild(t);
  f.y = 80; // separate from StepperItem above
  return f;
}

const variants = [chip('success','Score: 92%'), chip('warning','Score: 75%'), chip('danger','Score: 58%')];
const component = figma.combineAsVariants(variants, page);
component.name = 'ScoreChip';
return { id: component.id };
```

- [ ] **Step 3: Build `Status Dot` component (streaming / waiting / idle)**

```js
// description: "Build small Status Dot component used in AIPanel header"
const page = figma.root.children.find(p => p.name === '01 — Components');
await figma.setCurrentPageAsync(page);

const v = (name) => figma.variables.getLocalVariables('COLOR').find(x => x.name === name);

function dot(state, colorVar) {
  const f = figma.createFrame();
  f.name = `state=${state}`;
  f.resize(6, 6);
  f.cornerRadius = 9999;
  f.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', colorVar)];
  f.y = 160;
  return f;
}

const variants = [
  dot('streaming', v('color/semantic/success')),
  dot('waiting',   v('color/semantic/warning')),
  dot('idle',      v('color/fg/subtle')),
];
const component = figma.combineAsVariants(variants, page);
component.name = 'StatusDot';
return { id: component.id };
```

- [ ] **Step 4: Build `Segmented Control` component**

```js
// description: "Build 2-option segmented control component for Feed/Terminal toggle"
const page = figma.root.children.find(p => p.name === '01 — Components');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

const v = (n) => figma.variables.getLocalVariables('COLOR').find(x => x.name === n);

function seg(active /* 'left' | 'right' */) {
  const container = figma.createFrame();
  container.name = `active=${active}`;
  container.layoutMode = 'HORIZONTAL';
  container.itemSpacing = 2;
  container.paddingTop = 2; container.paddingBottom = 2; container.paddingLeft = 2; container.paddingRight = 2;
  container.cornerRadius = 6;
  container.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/bg/elevated'))];
  container.y = 220;

  for (const which of ['left','right']) {
    const btn = figma.createFrame();
    btn.name = which;
    btn.paddingTop = 4; btn.paddingBottom = 4; btn.paddingLeft = 8; btn.paddingRight = 8;
    btn.cornerRadius = 4;
    const isActive = which === active;
    btn.fills = isActive
      ? [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/bg/surface'))]
      : [];

    const t = figma.createText();
    t.characters = which === 'left' ? 'Feed' : 'Terminal';
    t.fontSize = 10;
    t.fontName = { family: 'Inter', style: 'Semi Bold' };
    t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', isActive ? v('color/fg/default') : v('color/fg/muted'))];
    btn.appendChild(t);
    container.appendChild(btn);
  }
  return container;
}

const variants = [seg('left'), seg('right')];
const component = figma.combineAsVariants(variants, page);
component.name = 'SegmentedControl';
return { id: component.id };
```

- [ ] **Step 5: Build `Logo` placeholder component**

```js
// description: "Build a Logo placeholder component — a rounded box with text, will be swapped by code Logo.tsx reading theme.logo"
const page = figma.root.children.find(p => p.name === '01 — Components');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

const v = (n) => figma.variables.getLocalVariables('COLOR').find(x => x.name === n);

const logo = figma.createFrame();
logo.name = 'Logo';
logo.resize(88, 24);
logo.cornerRadius = 6;
logo.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/brand/primary'))];
logo.layoutMode = 'HORIZONTAL';
logo.primaryAxisAlignItems = 'CENTER';
logo.counterAxisAlignItems = 'CENTER';
logo.y = 280;

const t = figma.createText();
t.characters = 'UDig';
t.fontSize = 12;
t.fontName = { family: 'Inter', style: 'Semi Bold' };
t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/brand/on-primary'))];
logo.appendChild(t);

const component = figma.createComponentFromNode(logo);
component.name = 'Logo';
return { id: component.id };
```

- [ ] **Step 6: Build `Waiting Banner` component**

```js
// description: "Build Waiting Banner used at bottom of AIPanel"
const page = figma.root.children.find(p => p.name === '01 — Components');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });

const v = (n) => figma.variables.getLocalVariables('COLOR').find(x => x.name === n);

const banner = figma.createFrame();
banner.name = 'WaitingBanner';
banner.layoutMode = 'HORIZONTAL';
banner.itemSpacing = 6;
banner.paddingTop = 8; banner.paddingBottom = 8; banner.paddingLeft = 10; banner.paddingRight = 10;
banner.cornerRadius = 8;
banner.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}, opacity:0.10}, 'color', v('color/semantic/warning'))];
banner.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}, opacity:0.3}, 'color', v('color/semantic/warning'))];
banner.y = 320;

const t = figma.createText();
t.characters = '⏸  Awaiting your approval';
t.fontSize = 10;
t.fontName = { family: 'Inter', style: 'Regular' };
t.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/semantic/warning'))];
banner.appendChild(t);

const component = figma.createComponentFromNode(banner);
component.name = 'WaitingBanner';
return { id: component.id };
```

- [ ] **Step 7: Screenshot for review**

Call `mcp__figma__get_screenshot` on the `01 — Components` page.

### Task 2.2: User review gate — Components page

**Files:** none (human gate)

- [ ] **Step 1: Present screenshot + Figma link to user**

Same format as Task 1.3. Include component count and brief list.

- [ ] **Step 2: Iterate on feedback if requested**

Move superseded versions to `99 — Archive`.

- [ ] **Step 3: Wait for explicit approval before Phase 3**

---

## Phase 3 — Figma: Foundation page (workspace shell)

### Task 3.1: Draft workspace shell in UDig mode

**Files:** Figma file (no codebase files)

- [ ] **Step 1: Create 1440×900 shell frame using components from Phase 2**

```js
// description: "Build workspace shell frame (TopBar + Stepper + main slot + AIPanel) on 02 — Foundation"
const page = figma.root.children.find(p => p.name === '02 — Foundation');
await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });

const v = (n) => figma.variables.getLocalVariables('COLOR').find(x => x.name === n);
const components = figma.root.children.find(p => p.name === '01 — Components').children;
const find = (name) => components.find(c => c.name === name);

const shell = figma.createFrame();
shell.name = 'Shell / 1440x900 / UDig / v1';
shell.resize(1440, 900);
shell.layoutMode = 'VERTICAL';
shell.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/bg/canvas'))];

// --- TopBar (56px) ---
const topBar = figma.createFrame();
topBar.name = 'TopBar';
topBar.resize(1440, 56);
topBar.layoutMode = 'HORIZONTAL';
topBar.itemSpacing = 12;
topBar.paddingLeft = 16; topBar.paddingRight = 16;
topBar.counterAxisAlignItems = 'CENTER';
topBar.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/bg/surface'))];
topBar.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/border/subtle'))];
topBar.strokeBottomWeight = 1; topBar.strokeTopWeight = 0; topBar.strokeLeftWeight = 0; topBar.strokeRightWeight = 0;

// Logo instance
const logoInst = find('Logo').createInstance();
topBar.appendChild(logoInst);

// Breadcrumb "← Sessions / filename.csv · 18,432 rows · 47 cols"
const breadcrumb = figma.createText();
breadcrumb.characters = '← Sessions   /   sales.csv   ·   18,432 rows · 47 cols';
breadcrumb.fontSize = 13;
breadcrumb.fontName = { family: 'Inter', style: 'Regular' };
breadcrumb.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/fg/muted'))];
topBar.appendChild(breadcrumb);

// Spacer
const spacer = figma.createFrame(); spacer.resize(1, 1); spacer.fills = []; spacer.layoutGrow = 1; topBar.appendChild(spacer);

// Score chip (success variant)
const scoreChip = find('ScoreChip').defaultVariant.createInstance();
scoreChip.setProperties({ variant: 'success' });
topBar.appendChild(scoreChip);

shell.appendChild(topBar);

// --- Body: horizontal layout (Stepper | main | AIPanel) ---
const body = figma.createFrame();
body.name = 'Body';
body.resize(1440, 844);
body.layoutMode = 'HORIZONTAL';
body.fills = [];

// Stepper (200px)
const stepper = figma.createFrame();
stepper.name = 'Stepper';
stepper.resize(200, 844);
stepper.layoutMode = 'VERTICAL';
stepper.itemSpacing = 2;
stepper.paddingTop = 20; stepper.paddingLeft = 12; stepper.paddingRight = 12;
stepper.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/bg/surface'))];
stepper.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/border/subtle'))];
stepper.strokeRightWeight = 1; stepper.strokeBottomWeight = 0; stepper.strokeLeftWeight = 0; stepper.strokeTopWeight = 0;

// Stage items (load done, profile active, others locked)
const STAGES = [
  ['Load','done'], ['Profile','active'], ['Explore','locked'], ['Rules','locked'],
  ['Validate','locked'], ['Triage','locked'], ['Plan','locked'], ['Transform','locked'],
  ['Scorecard','locked'], ['Pipeline','locked']
];
for (const [label, state] of STAGES) {
  const inst = find('StepperItem').defaultVariant.createInstance();
  inst.setProperties({ state });
  // override text — find text node inside instance
  const txt = inst.findOne(n => n.type === 'TEXT');
  if (txt) { await figma.loadFontAsync(txt.fontName); txt.characters = label; }
  stepper.appendChild(inst);

  // Sub-status under active
  if (state === 'active') {
    const sub = figma.createText();
    sub.characters = '  synthesizing…';
    sub.fontSize = 11;
    sub.fontName = { family: 'Inter', style: 'Regular' };
    sub.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/fg/subtle'))];
    stepper.appendChild(sub);
  }
}

// Main content slot
const main = figma.createFrame();
main.name = 'Main';
main.layoutGrow = 1;
main.resize(900, 844);
main.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/bg/canvas'))];

// AIPanel (340px)
const ai = figma.createFrame();
ai.name = 'AIPanel';
ai.resize(340, 844);
ai.layoutMode = 'VERTICAL';
ai.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/bg/surface'))];
ai.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/border/subtle'))];
ai.strokeLeftWeight = 1; ai.strokeRightWeight = 0; ai.strokeTopWeight = 0; ai.strokeBottomWeight = 0;

// AIPanel header
const aiHeader = figma.createFrame();
aiHeader.name = 'Header';
aiHeader.resize(340, 44);
aiHeader.layoutMode = 'HORIZONTAL';
aiHeader.itemSpacing = 8;
aiHeader.paddingLeft = 14; aiHeader.paddingRight = 14;
aiHeader.counterAxisAlignItems = 'CENTER';
aiHeader.fills = [];
aiHeader.strokes = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/border/subtle'))];
aiHeader.strokeBottomWeight = 1;

const statusDot = find('StatusDot').defaultVariant.createInstance();
statusDot.setProperties({ state: 'streaming' });
aiHeader.appendChild(statusDot);
const aiTitle = figma.createText();
aiTitle.characters = 'AI Activity';
aiTitle.fontSize = 12; aiTitle.fontName = { family: 'Inter', style: 'Semi Bold' };
aiTitle.fills = [figma.variables.setBoundVariableForPaint({type:'SOLID', color:{r:0,g:0,b:0}}, 'color', v('color/fg/default'))];
aiHeader.appendChild(aiTitle);
const aiSpacer = figma.createFrame(); aiSpacer.resize(1,1); aiSpacer.fills=[]; aiSpacer.layoutGrow=1; aiHeader.appendChild(aiSpacer);
const seg = find('SegmentedControl').defaultVariant.createInstance();
seg.setProperties({ active: 'left' });
aiHeader.appendChild(seg);

ai.appendChild(aiHeader);

// AIPanel body — placeholder feed area
const aiBody = figma.createFrame();
aiBody.resize(340, 740);
aiBody.fills = [];
aiBody.layoutGrow = 1;
ai.appendChild(aiBody);

// Waiting banner pinned to bottom
const wb = find('WaitingBanner').createInstance();
wb.x = 0; wb.layoutAlign = 'STRETCH';
ai.appendChild(wb);

body.appendChild(stepper);
body.appendChild(main);
body.appendChild(ai);
shell.appendChild(body);

return { id: shell.id };
```

- [ ] **Step 2: Screenshot for verification**

Call `mcp__figma__get_screenshot` on the shell frame at `maxDimension: 2048` so the details are legible.

### Task 3.2: Duplicate shell with Tractor Supply mode

**Files:** Figma file

- [ ] **Step 1: Clone the shell frame and switch its Brand mode**

```js
// description: "Duplicate the UDig shell, place it to the right, and switch to Tractor Supply mode"
const page = figma.root.children.find(p => p.name === '02 — Foundation');
await figma.setCurrentPageAsync(page);

const original = page.findOne(n => n.name === 'Shell / 1440x900 / UDig / v1');
const clone = original.clone();
clone.name = 'Shell / 1440x900 / Tractor Supply / v1';
clone.x = original.x + original.width + 80;

const brand = figma.variables.getLocalVariableCollections().find(c => c.name === 'Brand');
const tsMode = brand.modes.find(m => m.name === 'Tractor Supply').modeId;
clone.setExplicitVariableModeForCollection(brand, tsMode);

return { id: clone.id };
```

- [ ] **Step 2: Screenshot the side-by-side comparison**

Call `mcp__figma__get_screenshot` on the parent page or a bounding frame so both shells are visible.

### Task 3.3: User review gate — Foundation page

**Files:** none (human gate)

- [ ] **Step 1: Present side-by-side screenshot + Figma link**

Make clear this is the "demo reveal" reference — the same screen reskinned by switching one variable mode.

- [ ] **Step 2: Iterate on feedback if requested**

Per-iteration: bump to `v2`, archive `v1` on page `99 — Archive`.

- [ ] **Step 3: Wait for explicit approval before Phase 4**

Once approved, the approved frame nodeId for `Shell / 1440x900 / UDig / v<final>` is the source of truth `get_design_context` reads from during code translation.

---

## Phase 4 — Code translation

> All code edits run from the repo root. Files live under `frontend/`. Run tests with `cd frontend && npx jest`.

### Task 4.1: Read approved Figma variable values

**Files:** none (read from Figma)

- [ ] **Step 1: Pull variable definitions from Figma**

Run `mcp__figma__get_variable_defs` on the approved shell frame nodeId. Save the resulting JSON — it contains the resolved color and numeric values for both modes. These are the source of truth for `themes/udig.ts` and `themes/tractor-supply.ts` plus `globals.css` defaults.

- [ ] **Step 2: Cross-check against UDig brand assets from Task 0.3**

If Figma values differ from Task 0.3 (e.g., we tweaked them during review), Figma wins. Document the final values in a short note for the upcoming theme files.

### Task 4.2: Create `Theme` type

**Files:**
- Create: `frontend/lib/theme/types.ts`
- Test: (no separate test — exercised indirectly by resolve/apply tests)

- [ ] **Step 1: Write `types.ts`**

```ts
// frontend/lib/theme/types.ts

export type ThemeId = string;

export interface ThemeLogo {
  src: string;
  width: number;
  height: number;
  alt?: string;
}

export interface BrandColors {
  primary: string;
  accent: string;
  onPrimary: string;
}

export interface SemanticColors {
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface Theme {
  id: ThemeId;
  displayName: string;
  logo: ThemeLogo;
  faviconUrl?: string;
  brand: BrandColors;
  /** If omitted, system defaults are used. */
  semantic?: Partial<SemanticColors>;
  /** Optional override of the display font family. Body font is system-fixed. */
  fontDisplay?: string;
}
```

- [ ] **Step 2: Type-check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/theme/types.ts
git commit -m "feat(theme): add Theme TS type"
```

### Task 4.3: Implement and test `resolve.ts`

**Files:**
- Create: `frontend/lib/theme/resolve.ts`
- Create: `frontend/lib/theme/themes/_registry.ts` (stub for test)
- Test: `frontend/__tests__/lib/theme/resolve.test.ts`

- [ ] **Step 1: Write stub registry for the test to import**

```ts
// frontend/lib/theme/themes/_registry.ts
import type { Theme } from '../types';

// Stubs — actual values written in Task 4.5
export const udig: Theme = {
  id: 'udig',
  displayName: 'UDig',
  logo: { src: '/logos/udig.svg', width: 88, height: 24, alt: 'UDig' },
  brand: { primary: '#000000', accent: '#000000', onPrimary: '#FFFFFF' },
};

export const tractorSupply: Theme = {
  id: 'tractor-supply',
  displayName: 'Tractor Supply',
  logo: { src: '/logos/tractor-supply.svg', width: 88, height: 24, alt: 'Tractor Supply' },
  brand: { primary: '#000000', accent: '#000000', onPrimary: '#FFFFFF' },
};

export const themes = { udig, 'tractor-supply': tractorSupply } as const;
export const DEFAULT_THEME_ID = 'udig';
```

- [ ] **Step 2: Write the failing test**

```ts
// frontend/__tests__/lib/theme/resolve.test.ts
import { resolveThemeId } from '@/lib/theme/resolve';

describe('resolveThemeId', () => {
  it('returns default when no URL param and no env var', () => {
    expect(resolveThemeId({ searchParam: null, envVar: undefined })).toBe('udig');
  });

  it('returns env var theme when no URL param', () => {
    expect(resolveThemeId({ searchParam: null, envVar: 'tractor-supply' })).toBe('tractor-supply');
  });

  it('URL param wins over env var', () => {
    expect(resolveThemeId({ searchParam: 'udig', envVar: 'tractor-supply' })).toBe('udig');
  });

  it('falls back to default when URL param is an unknown id', () => {
    expect(resolveThemeId({ searchParam: 'mystery-corp', envVar: undefined })).toBe('udig');
  });

  it('falls back to default when env var is an unknown id', () => {
    expect(resolveThemeId({ searchParam: null, envVar: 'mystery-corp' })).toBe('udig');
  });
});
```

- [ ] **Step 3: Run the test, see it fail**

```bash
cd frontend && npx jest __tests__/lib/theme/resolve.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `resolve.ts`**

```ts
// frontend/lib/theme/resolve.ts
import { themes, DEFAULT_THEME_ID } from './themes/_registry';
import type { Theme, ThemeId } from './types';

export interface ResolveArgs {
  /** From `useSearchParams().get('client')` or equivalent. */
  searchParam: string | null;
  /** From `process.env.NEXT_PUBLIC_CLIENT`. */
  envVar: string | undefined;
}

export function resolveThemeId(args: ResolveArgs): ThemeId {
  const candidates = [args.searchParam, args.envVar];
  for (const c of candidates) {
    if (c && c in themes) return c as ThemeId;
  }
  return DEFAULT_THEME_ID;
}

export function resolveTheme(args: ResolveArgs): Theme {
  const id = resolveThemeId(args);
  return themes[id as keyof typeof themes];
}
```

- [ ] **Step 5: Run tests, verify pass**

```bash
cd frontend && npx jest __tests__/lib/theme/resolve.test.ts
```
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/theme/resolve.ts frontend/lib/theme/themes/_registry.ts frontend/__tests__/lib/theme/resolve.test.ts
git commit -m "feat(theme): add theme resolution (URL > env > default)"
```

### Task 4.4: Implement and test `apply.ts`

**Files:**
- Create: `frontend/lib/theme/apply.ts`
- Test: `frontend/__tests__/lib/theme/apply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/__tests__/lib/theme/apply.test.ts
import { writeTokensToRoot } from '@/lib/theme/apply';
import type { Theme } from '@/lib/theme/types';

const sample: Theme = {
  id: 'sample',
  displayName: 'Sample',
  logo: { src: '/x.svg', width: 1, height: 1 },
  brand: { primary: '#112233', accent: '#445566', onPrimary: '#FFFFFF' },
  semantic: { danger: '#FF0000' },
};

describe('writeTokensToRoot', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.documentElement.removeAttribute('data-theme');
  });

  it('sets brand color CSS variables on documentElement', () => {
    writeTokensToRoot(sample);
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--color-brand-primary')).toBe('#112233');
    expect(style.getPropertyValue('--color-brand-accent')).toBe('#445566');
    expect(style.getPropertyValue('--color-brand-on-primary')).toBe('#FFFFFF');
  });

  it('sets the data-theme attribute', () => {
    writeTokensToRoot(sample);
    expect(document.documentElement.getAttribute('data-theme')).toBe('sample');
  });

  it('applies semantic overrides when present', () => {
    writeTokensToRoot(sample);
    expect(document.documentElement.style.getPropertyValue('--color-semantic-danger')).toBe('#FF0000');
  });

  it('leaves semantic vars unset when theme does not override them', () => {
    const noSemantic: Theme = { ...sample, semantic: undefined };
    writeTokensToRoot(noSemantic);
    expect(document.documentElement.style.getPropertyValue('--color-semantic-danger')).toBe('');
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
cd frontend && npx jest __tests__/lib/theme/apply.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// frontend/lib/theme/apply.ts
import type { Theme } from './types';

export function writeTokensToRoot(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);

  // Brand
  root.style.setProperty('--color-brand-primary', theme.brand.primary);
  root.style.setProperty('--color-brand-accent', theme.brand.accent);
  root.style.setProperty('--color-brand-on-primary', theme.brand.onPrimary);

  // Optional semantic overrides
  if (theme.semantic) {
    for (const [k, v] of Object.entries(theme.semantic)) {
      if (v) root.style.setProperty(`--color-semantic-${k}`, v);
    }
  }

  // Display font (optional)
  if (theme.fontDisplay) {
    root.style.setProperty('--font-display', theme.fontDisplay);
  }
}
```

- [ ] **Step 4: Run, pass**

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/theme/apply.ts frontend/__tests__/lib/theme/apply.test.ts
git commit -m "feat(theme): write theme tokens to documentElement style"
```

### Task 4.5: Populate real theme values

**Files:**
- Modify: `frontend/lib/theme/themes/_registry.ts`
- Create: `frontend/lib/theme/themes/udig.ts`
- Create: `frontend/lib/theme/themes/tractor-supply.ts`

- [ ] **Step 1: Write `udig.ts` using values from Task 4.1**

Replace `<UDIG_*_HEX>` with the values pulled from Figma in Task 4.1.

```ts
// frontend/lib/theme/themes/udig.ts
import type { Theme } from '../types';

export const udig: Theme = {
  id: 'udig',
  displayName: 'UDig',
  logo: { src: '/logos/udig.svg', width: 88, height: 24, alt: 'UDig' },
  faviconUrl: '/favicons/udig.ico',
  brand: {
    primary:   '<UDIG_PRIMARY_HEX>',
    accent:    '<UDIG_ACCENT_HEX>',
    onPrimary: '#FFFFFF',
  },
};
```

- [ ] **Step 2: Write `tractor-supply.ts`**

```ts
// frontend/lib/theme/themes/tractor-supply.ts
import type { Theme } from '../types';

export const tractorSupply: Theme = {
  id: 'tractor-supply',
  displayName: 'Tractor Supply',
  logo: { src: '/logos/tractor-supply.svg', width: 88, height: 24, alt: 'Tractor Supply' },
  brand: {
    primary:   '#D62828',
    accent:    '#1A1A1A',
    onPrimary: '#FFFFFF',
  },
};
```

- [ ] **Step 3: Update `_registry.ts` to import from the new files**

```ts
// frontend/lib/theme/themes/_registry.ts
import type { Theme } from '../types';
import { udig } from './udig';
import { tractorSupply } from './tractor-supply';

export const themes = {
  'udig': udig,
  'tractor-supply': tractorSupply,
} as const;

export type RegisteredThemeId = keyof typeof themes;
export const DEFAULT_THEME_ID: RegisteredThemeId = 'udig';
```

- [ ] **Step 4: Re-run resolve tests**

```bash
cd frontend && npx jest __tests__/lib/theme/resolve.test.ts
```
Expected: PASS (still 5).

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/theme/themes/
git commit -m "feat(theme): populate UDig and Tractor Supply theme values"
```

### Task 4.6: Implement and test `<Logo />`

**Files:**
- Create: `frontend/components/theme/Logo.tsx`
- Test: `frontend/__tests__/components/theme/Logo.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/components/theme/Logo.test.tsx
import { render, screen } from '@testing-library/react';
import { Logo } from '@/components/theme/Logo';

const themeLogo = { src: '/logos/x.svg', width: 88, height: 24, alt: 'Acme' };

jest.mock('@/components/theme/useActiveTheme', () => ({
  useActiveTheme: () => ({ logo: themeLogo, displayName: 'Acme' }),
}));

describe('Logo', () => {
  it('renders an image with theme logo src and alt', () => {
    render(<Logo />);
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/logos/x.svg');
    expect(img).toHaveAttribute('alt', 'Acme');
  });
});
```

- [ ] **Step 2: Run, fail**

```bash
cd frontend && npx jest __tests__/components/theme/Logo.test.tsx
```
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `useActiveTheme` hook stub**

```tsx
// frontend/components/theme/useActiveTheme.ts
'use client';
import { createContext, useContext } from 'react';
import type { Theme } from '@/lib/theme/types';
import { udig } from '@/lib/theme/themes/udig';

export const ActiveThemeContext = createContext<Theme>(udig);
export function useActiveTheme(): Theme {
  return useContext(ActiveThemeContext);
}
```

- [ ] **Step 4: Implement `Logo.tsx`**

```tsx
// frontend/components/theme/Logo.tsx
'use client';
import { useActiveTheme } from './useActiveTheme';

export function Logo() {
  const theme = useActiveTheme();
  return (
    <img
      src={theme.logo.src}
      alt={theme.logo.alt ?? theme.displayName}
      width={theme.logo.width}
      height={theme.logo.height}
    />
  );
}
```

- [ ] **Step 5: Run, pass**

Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add frontend/components/theme/
git commit -m "feat(theme): add useActiveTheme + Logo component"
```

### Task 4.7: Implement and test `<ThemeProvider />`

**Files:**
- Create: `frontend/components/theme/ThemeProvider.tsx`
- Test: `frontend/__tests__/components/theme/ThemeProvider.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/__tests__/components/theme/ThemeProvider.test.tsx
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('style');
  });

  it('renders children', () => {
    render(
      <ThemeProvider initialClient={null}>
        <div>hello</div>
      </ThemeProvider>
    );
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('sets data-theme=udig by default', () => {
    render(
      <ThemeProvider initialClient={null}>
        <span />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('udig');
  });

  it('honors initialClient prop', () => {
    render(
      <ThemeProvider initialClient="tractor-supply">
        <span />
      </ThemeProvider>
    );
    expect(document.documentElement.getAttribute('data-theme')).toBe('tractor-supply');
  });
});
```

- [ ] **Step 2: Run, fail**

Expected: FAIL.

- [ ] **Step 3: Implement**

```tsx
// frontend/components/theme/ThemeProvider.tsx
'use client';
import { useEffect, useState } from 'react';
import { ActiveThemeContext } from './useActiveTheme';
import { resolveTheme } from '@/lib/theme/resolve';
import { writeTokensToRoot } from '@/lib/theme/apply';

interface Props {
  /** Optional pre-resolved client (e.g., from server-side URL). */
  initialClient?: string | null;
  children: React.ReactNode;
}

export function ThemeProvider({ initialClient = null, children }: Props) {
  const [theme, setTheme] = useState(() =>
    resolveTheme({
      searchParam: initialClient,
      envVar: process.env.NEXT_PUBLIC_CLIENT,
    })
  );

  useEffect(() => {
    // Re-resolve from window URL in case server didn't pass initialClient
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('client');
      if (param) {
        const resolved = resolveTheme({ searchParam: param, envVar: process.env.NEXT_PUBLIC_CLIENT });
        setTheme(resolved);
      }
    }
  }, []);

  useEffect(() => {
    writeTokensToRoot(theme);
  }, [theme]);

  return (
    <ActiveThemeContext.Provider value={theme}>
      {children}
    </ActiveThemeContext.Provider>
  );
}
```

- [ ] **Step 4: Run, pass**

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/theme/ThemeProvider.tsx frontend/__tests__/components/theme/ThemeProvider.test.tsx
git commit -m "feat(theme): add ThemeProvider client component"
```

### Task 4.8: Rewrite `globals.css` with full token set

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Replace the file's body with the full token set**

Use the Figma-pulled values from Task 4.1 for the surface/fg/border/semantic defaults. UDig values are the static fallback before JS runs.

```css
/* frontend/app/globals.css */
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  /* Brand — UDig defaults (overridden at runtime by ThemeProvider) */
  --color-brand-primary:    #1E3A8A;   /* replace with actual UDIG_PRIMARY_HEX */
  --color-brand-accent:     #F59E0B;   /* replace with actual UDIG_ACCENT_HEX */
  --color-brand-on-primary: #FFFFFF;

  /* Surfaces */
  --color-bg-canvas:    #F8FAFC;
  --color-bg-surface:   #FFFFFF;
  --color-bg-elevated:  #F1F5F9;

  /* Text */
  --color-fg-default: #0F172A;
  --color-fg-muted:   #475569;
  --color-fg-subtle:  #94A3B8;
  --color-fg-inverse: #FFFFFF;

  /* Borders */
  --color-border-subtle: #E2E8F0;
  --color-border-strong: #CBD5E1;

  /* Semantic */
  --color-semantic-success: #22C55E;
  --color-semantic-warning: #F59E0B;
  --color-semantic-danger:  #EF4444;
  --color-semantic-info:    #3B82F6;

  /* Type */
  --font-body:    'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  --font-display: var(--font-body);
  --font-mono:    ui-monospace, SFMono-Regular, Menlo, monospace;

  /* Radius */
  --radius-sm:   4px;
  --radius-md:   8px;
  --radius-lg:   12px;
  --radius-full: 9999px;
}

body {
  background: var(--color-bg-canvas);
  color: var(--color-fg-default);
  font-family: var(--font-body);
}
```

- [ ] **Step 2: Verify no tests broke**

```bash
cd frontend && npx jest
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "style(theme): write full token CSS variable set to :root"
```

### Task 4.9: Rewire `tailwind.config.ts` to use CSS vars

**Files:**
- Modify: `frontend/tailwind.config.ts`

- [ ] **Step 1: Replace the config**

```ts
// frontend/tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Brand (themeable)
        'brand-primary':     'var(--color-brand-primary)',
        'brand-accent':      'var(--color-brand-accent)',
        'on-brand':          'var(--color-brand-on-primary)',

        // Surfaces (system)
        canvas:    'var(--color-bg-canvas)',
        surface:   'var(--color-bg-surface)',
        elevated:  'var(--color-bg-elevated)',

        // Text
        fg:           'var(--color-fg-default)',
        'fg-muted':   'var(--color-fg-muted)',
        'fg-subtle':  'var(--color-fg-subtle)',
        'fg-inverse': 'var(--color-fg-inverse)',

        // Borders
        border:          'var(--color-border-subtle)',
        'border-strong': 'var(--color-border-strong)',

        // Semantic
        success: 'var(--color-semantic-success)',
        warning: 'var(--color-semantic-warning)',
        danger:  'var(--color-semantic-danger)',
        info:    'var(--color-semantic-info)',

        // --- Compatibility aliases for existing class usages ---
        // The current codebase uses bg-bg, text-text-primary, etc.
        // Map them to new tokens so stage components keep working untouched.
        bg:                  'var(--color-bg-canvas)',
        'surface-raised':    'var(--color-bg-canvas)',
        'text-primary':      'var(--color-fg-default)',
        'text-secondary':    'var(--color-fg-muted)',
        'text-muted':        'var(--color-fg-subtle)',

        // Old indigo references (shell-only; replaced in components in Tasks 4.11–4.13)
        indigo: { DEFAULT: 'var(--color-brand-primary)', light: 'var(--color-brand-primary)' },

        // Old success/warning/danger .light variants — map to base
        'success-light': 'var(--color-semantic-success)',
        'warning-light': 'var(--color-semantic-warning)',
        'danger-light':  'var(--color-semantic-danger)',
      },
      fontFamily: {
        sans:    ['var(--font-body)', 'sans-serif'],
        display: ['var(--font-display)', 'sans-serif'],
        mono:    ['var(--font-mono)', 'monospace'],
      },
      borderRadius: {
        sm:   'var(--radius-sm)',
        md:   'var(--radius-md)',
        lg:   'var(--radius-lg)',
        full: 'var(--radius-full)',
      },
    },
  },
  plugins: [],
};
export default config;
```

> **Why compatibility aliases:** stage components (`components/stages/*.tsx`) reference classes like `bg-bg`, `text-text-primary`, `bg-indigo/10`. The aliases keep them rendering without touching those files in this round. Real cleanup happens per-stage in Round 2.

- [ ] **Step 2: Run the dev server, eyeball /sessions**

```bash
cd frontend && npm run dev
```
Visit `http://localhost:3000/sessions`. Expected: page renders without obvious style breakage. Some indigo accents may now appear in the brand color instead of `#6366f1` — that's correct.

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add frontend/tailwind.config.ts
git commit -m "build(theme): rewire Tailwind to consume CSS variable tokens"
```

### Task 4.10: Add logo assets

**Files:**
- Create: `frontend/public/logos/udig.svg`
- Create: `frontend/public/logos/tractor-supply.svg`

- [ ] **Step 1: Place UDig logo SVG**

Drop the UDig logo SVG (from Task 0.3) at `frontend/public/logos/udig.svg`. If you don't have it, create a placeholder SVG with the UDig wordmark as text — flag for replacement.

- [ ] **Step 2: Place Tractor Supply placeholder SVG**

Create a simple wordmark SVG at `frontend/public/logos/tractor-supply.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="160" height="24" viewBox="0 0 160 24">
  <text x="0" y="18" font-family="Inter, sans-serif" font-size="16" font-weight="700" fill="#D62828">Tractor Supply</text>
</svg>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/public/logos/
git commit -m "assets(theme): add UDig and Tractor Supply logo SVGs"
```

### Task 4.11: Wrap root layout with `<ThemeProvider />`

**Files:**
- Modify: `frontend/app/layout.tsx`

> **Before editing:** confirm the Next 16 root-layout pattern read in Task 0.2. The provider is a client component; wrapping `{children}` is supported, but verify there are no breaking changes in how `<html>` / `<body>` and metadata coexist with a client wrapper.

- [ ] **Step 1: Edit `layout.tsx`**

```tsx
// frontend/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme/ThemeProvider';

export const metadata: Metadata = { title: 'DQ Accelerator' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-canvas text-fg antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Smoke-test on localhost**

```bash
cd frontend && npm run dev
```

Visit `http://localhost:3000/sessions`. Expected: page loads. Inspect `<html>` element in devtools — `data-theme="udig"` should be present after hydration. Visit `http://localhost:3000/sessions?client=tractor-supply` — `data-theme` should change to `tractor-supply`.

Stop dev server.

- [ ] **Step 3: Run all tests**

```bash
cd frontend && npx jest
```
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat(theme): mount ThemeProvider in root layout"
```

### Task 4.12: Update `TopBar.tsx`

**Files:**
- Modify: `frontend/components/workspace/TopBar.tsx`
- Test: `frontend/__tests__/components/workspace/TopBar.test.tsx`

- [ ] **Step 1: Write the failing test for score-chip variant logic**

```tsx
// frontend/__tests__/components/workspace/TopBar.test.tsx
import { render, screen } from '@testing-library/react';
import { TopBar } from '@/components/workspace/TopBar';

describe('TopBar score chip', () => {
  it('uses success variant when score >= 0.9', () => {
    render(<TopBar filename="x.csv" currentScore={0.92} />);
    const chip = screen.getByText(/Score: 92%/);
    expect(chip.parentElement).toHaveAttribute('data-variant', 'success');
  });

  it('uses warning variant when 0.7 <= score < 0.9', () => {
    render(<TopBar filename="x.csv" currentScore={0.75} />);
    expect(screen.getByText(/Score: 75%/).parentElement).toHaveAttribute('data-variant', 'warning');
  });

  it('uses danger variant when score < 0.7', () => {
    render(<TopBar filename="x.csv" currentScore={0.58} />);
    expect(screen.getByText(/Score: 58%/).parentElement).toHaveAttribute('data-variant', 'danger');
  });

  it('hides chip when no score', () => {
    render(<TopBar filename="x.csv" />);
    expect(screen.queryByText(/Score:/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, fail**

Expected: FAIL — no `data-variant`.

- [ ] **Step 3: Rewrite `TopBar.tsx`**

```tsx
// frontend/components/workspace/TopBar.tsx
import Link from 'next/link';
import { Logo } from '@/components/theme/Logo';

interface Props {
  filename: string;
  rowCount?: number;
  colCount?: number;
  currentScore?: number;
}

type ScoreVariant = 'success' | 'warning' | 'danger';
function getScoreVariant(pct: number): ScoreVariant {
  if (pct >= 90) return 'success';
  if (pct >= 70) return 'warning';
  return 'danger';
}

const variantClasses: Record<ScoreVariant, string> = {
  success: 'text-success border-success/40 bg-success/10',
  warning: 'text-warning border-warning/40 bg-warning/10',
  danger:  'text-danger  border-danger/40  bg-danger/10',
};

export function TopBar({ filename, rowCount, colCount, currentScore }: Props) {
  const pct = currentScore ? Math.round(currentScore * 100) : null;
  const variant = pct === null ? null : getScoreVariant(pct);

  return (
    <div className="h-14 bg-surface border-b border-border flex items-center gap-3 px-4 shrink-0">
      <Logo />
      <Link href="/" className="text-fg-muted text-xs hover:text-fg">← Sessions</Link>
      <span className="text-border">/</span>
      <span className="font-semibold text-sm text-fg">{filename}</span>
      {rowCount && (
        <span className="text-xs text-fg-muted">
          {rowCount.toLocaleString()} rows · {colCount} cols
        </span>
      )}
      {pct !== null && variant !== null && (
        <div
          data-variant={variant}
          className={`ml-auto border rounded-full px-2.5 py-0.5 text-xs font-semibold ${variantClasses[variant]}`}
        >
          Score: {pct}%
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run, pass**

```bash
cd frontend && npx jest __tests__/components/workspace/TopBar.test.tsx
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/workspace/TopBar.tsx frontend/__tests__/components/workspace/TopBar.test.tsx
git commit -m "feat(topbar): use Logo + tokens + semantic score chip variants"
```

### Task 4.13: Update `Stepper.tsx`

**Files:**
- Modify: `frontend/components/workspace/Stepper.tsx`

- [ ] **Step 1: Rewrite the component**

```tsx
// frontend/components/workspace/Stepper.tsx
'use client';

export type StageId = 'load' | 'profile' | 'explore' | 'rules' | 'validate' | 'triage' | 'plan' | 'transform' | 'scorecard' | 'pipeline';

const STAGES: { id: StageId; label: string }[] = [
  { id: 'load',      label: 'Load' },
  { id: 'profile',   label: 'Profile' },
  { id: 'explore',   label: 'Explore' },
  { id: 'rules',     label: 'Rules' },
  { id: 'validate',  label: 'Validate' },
  { id: 'triage',    label: 'Triage' },
  { id: 'plan',      label: 'Plan' },
  { id: 'transform', label: 'Transform' },
  { id: 'scorecard', label: 'Scorecard' },
  { id: 'pipeline',  label: 'Pipeline' },
];

interface Props {
  activeStage: StageId;
  completedStages: StageId[];
  viewingStage: StageId;
  onStageClick: (stage: StageId) => void;
  /** Optional sub-status line shown under the active stage. */
  activeSubStatus?: string;
}

export function Stepper({ activeStage, completedStages, viewingStage, onStageClick, activeSubStatus }: Props) {
  return (
    <div className="w-[200px] bg-surface border-r border-border px-3 py-5 shrink-0 flex flex-col gap-0.5 overflow-y-auto">
      {STAGES.map((s, i) => {
        const done = completedStages.includes(s.id);
        const active = s.id === activeStage;
        const viewing = s.id === viewingStage;
        const locked = !done && !active;
        const clickable = done && s.id !== activeStage;

        return (
          <div key={s.id}>
            <div
              className={[
                'flex items-center gap-2 px-2 py-1.5 rounded-lg',
                viewing ? 'bg-brand-primary/10' : '',
                clickable ? 'cursor-pointer hover:bg-elevated' : '',
                locked ? 'opacity-35' : '',
              ].join(' ')}
              onClick={() => clickable && onStageClick(s.id)}
            >
              <div
                className={[
                  'w-2 h-2 rounded-full shrink-0',
                  done ? 'bg-success' : '',
                  active ? 'bg-brand-primary' : '',
                  !done && !active ? 'bg-border border border-fg-subtle' : '',
                ].join(' ')}
              />
              <span
                className={[
                  'text-xs',
                  viewing || active ? 'text-fg font-semibold' : 'text-fg-muted',
                ].join(' ')}
              >
                {s.label}
              </span>
            </div>

            {active && activeSubStatus && (
              <div className="pl-[34px] -mt-0.5 mb-1 text-[11px] text-fg-subtle">
                {activeSubStatus}
              </div>
            )}

            {i < STAGES.length - 1 && (
              <div className={`w-px h-3.5 ml-[19px] ${done ? 'bg-success/40' : 'bg-border'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
```

> Note: dropped `shadow-[0_0_6px_#6366f1]` from active dot. If you want the glow back later, use `shadow-[0_0_6px_var(--color-brand-primary)]`.

- [ ] **Step 2: Wire `activeSubStatus` through `sessions/[id]/page.tsx`**

In `frontend/app/sessions/[id]/page.tsx`, pass the existing `WAITING_MESSAGES[stage]` as `activeSubStatus`:

```tsx
<Stepper
  activeStage={active}
  completedStages={completed}
  viewingStage={displayStage}
  onStageClick={setViewingStage}
  activeSubStatus={WAITING_MESSAGES[stage]}
/>
```

- [ ] **Step 3: Smoke-test on localhost**

```bash
cd frontend && npm run dev
```

Open `/sessions/<id>` for an in-progress session. Active stage dot should be the brand color (UDig blue by default). Visit `?client=tractor-supply` — the dot should switch to red. Sub-status text should appear under the active stage when one of the `WAITING_MESSAGES` matches.

Stop dev server.

- [ ] **Step 4: Run all tests**

```bash
cd frontend && npx jest
```
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/workspace/Stepper.tsx frontend/app/sessions/\[id\]/page.tsx
git commit -m "feat(stepper): use brand-primary token + add sub-status line"
```

### Task 4.14: Update `AIPanel.tsx`

**Files:**
- Modify: `frontend/components/ai-panel/AIPanel.tsx`

- [ ] **Step 1: Rewrite the component**

```tsx
// frontend/components/ai-panel/AIPanel.tsx
'use client';
import { useState } from 'react';
import type { AIEvent } from '@/hooks/useAIStream';
import { EventFeed } from './EventFeed';
import { EventTerminal } from './EventTerminal';

interface Props {
  events: AIEvent[];
  isStreaming: boolean;
  waitingMessage?: string;
}

type DotState = 'streaming' | 'waiting' | 'idle';
const dotClasses: Record<DotState, string> = {
  streaming: 'bg-success',
  waiting:   'bg-warning',
  idle:      'bg-fg-subtle',
};

export function AIPanel({ events, isStreaming, waitingMessage }: Props) {
  const [view, setView] = useState<'feed' | 'terminal'>('feed');
  const dotState: DotState = isStreaming ? 'streaming' : waitingMessage ? 'waiting' : 'idle';

  return (
    <div className="w-[340px] bg-surface border-l border-border flex flex-col shrink-0">
      <div className="px-3.5 py-2.5 border-b border-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-fg">
          <div className={`w-1.5 h-1.5 rounded-full ${dotClasses[dotState]}`} />
          AI Activity
        </div>
        <div className="flex bg-elevated rounded-md p-0.5 gap-0.5">
          {(['feed', 'terminal'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`text-[10px] px-2 py-1 rounded capitalize ${
                view === v ? 'bg-surface text-fg' : 'text-fg-muted hover:text-fg'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'feed' ? <EventFeed events={events} /> : <EventTerminal events={events} />}

      {waitingMessage && (
        <div className="m-2 bg-warning/10 border border-warning/30 rounded-lg p-2.5 text-[10px] text-warning shrink-0">
          ⏸ {waitingMessage}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Smoke-test**

Same flow: dev server, view a session, check panel renders, swap to Tractor Supply theme.

- [ ] **Step 3: Run all tests**

```bash
cd frontend && npx jest
```
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/ai-panel/AIPanel.tsx
git commit -m "feat(ai-panel): use tokens for status dot, segmented control, and waiting banner"
```

---

## Phase 5 — Verification & wrap-up

### Task 5.1: Full local verification

**Files:** none (verification only)

- [ ] **Step 1: Run lint + format**

```bash
cd frontend && (npx eslint . || true) && (npx prettier --check . || true)
```
Expected: no errors (warnings acceptable). The repo doesn't enforce these in CI, so this is best-effort.

- [ ] **Step 2: Run all tests with coverage**

```bash
cd frontend && npx jest --coverage
```
Expected: all green. New theme code should have ≥ 80% coverage.

- [ ] **Step 3: Manual smoke on localhost (default theme)**

```bash
cd frontend && npm run dev
```

Walk through (no need to drive a full workflow; just open an existing session if one exists, or `/sessions`):
1. `/sessions` — list renders with new chrome.
2. `/sessions/<id>` — TopBar shows UDig logo, Stepper shows blue brand-primary active dot, AIPanel renders.
3. Devtools: `<html data-theme="udig">`, CSS vars on `:root` resolve.

- [ ] **Step 4: Manual smoke on localhost (Tractor Supply theme)**

Navigate to `/sessions/<id>?client=tractor-supply`. Expected:
- TopBar logo swaps to Tractor Supply mark.
- Stepper active dot turns red.
- All semantic colors (success/warning/danger chips) remain unchanged.
- `<html data-theme="tractor-supply">` in devtools.

- [ ] **Step 5: Manual smoke — unknown client**

Navigate to `/sessions/<id>?client=mystery-corp`. Expected: falls back to UDig theme. No errors in console.

- [ ] **Step 6: Run app from a clean session (Gate A check)**

Start a new session (upload a file) and watch it move through Load → Profile. Confirm the shell stays themed throughout, including during streaming. Confirm `WAITING_MESSAGES` now appears under the active stage in the Stepper sub-status slot.

Stop dev server.

### Task 5.2: Final commit + tag

**Files:** none (git only)

- [ ] **Step 1: Confirm working tree is clean**

```bash
git status
```
Expected: clean.

- [ ] **Step 2: View commit log for Round 1**

```bash
git log --oneline main..HEAD
```
Expected: a sequence of small commits from Task 0 through Task 4.14.

- [ ] **Step 3: Tag the foundation milestone**

```bash
git tag -a foundation-v1 -m "Round 1 (Foundation) complete: tokens + theming + shell"
```

- [ ] **Step 4: Report Gate A status to user**

Tell the user: foundation pass complete, both themes verified on localhost, working tree clean, tag `foundation-v1` placed. Ask whether to proceed to Round 2 stage 1 (Load) — that planning is a separate `writing-plans` invocation later, not part of this plan.

---

## Self-review notes (recorded after writing)

- **Spec coverage:** every section of the spec maps to a phase. §1 (round-trip mechanics) → all phases. §2 (token architecture) → Task 1.1, 4.2–4.5, 4.8–4.9. §3 (Figma structure) → Task 1.1, 2.1, 3.1. §4 (workspace shell layout) → Task 3.1, 3.2, 4.11–4.14. §5 (code integration plan) → Tasks 4.2–4.14. §6 (work order Round 1 steps 1–8) → Phases 0–5.
- **Placeholders:** the only `<…>` placeholders are for UDig brand hex values, pulled at runtime in Tasks 0.3 and 4.1. These are intentional and gated by the human review in Task 0.3.
- **Type consistency:** `Theme` shape consistent across Tasks 4.2, 4.3, 4.4, 4.5, 4.6, 4.7. `StageId` unchanged. `resolveTheme` signature consistent.
- **Out of scope:** stage screen redesigns, dark mode, `/` landing and `/sessions` list page redesigns, motion design beyond defaults, mobile/tablet. (Matches spec.)
