# Quarry brand

Quarry is an analytics tool, so the identity stays out of the way of the data. It should
read as a calm, precise instrument: stone-coloured neutrals, one mineral accent, a typeface
built for technical reading, and no decoration that is not doing a job.

## Name and voice

- **Name:** Quarry. Written in lower case in the wordmark ("quarry"), sentence case in text.
  A quarry is where you dig material out of rock; the product digs answers out of data.
- **Voice:** plain, specific, international English. Say what happened and what it means.
  Prefer "Ran out of steps" to "Oops!", "Demo limit reached" to "Slow down!". No exclamation
  marks, no emoji, no anthropomorphic filler ("I'd be happy to...").
- **Numbers:** always attributable. In the UI a number that came from data is a button
  that opens the query behind it.

## Logo

A square tile in the accent colour with a cut block inside it: a rectangle with one corner
chiselled off. It is drawn in code (`web/components/icons.tsx`, `Mark`), so it inherits
light and dark themes.

```
┌──────────┐
│ ┌────╲   │   tile: --accent, 4px radius
│ │     │  │   block: --surface, top-right corner cut at 45°
│ └─────┘  │
└──────────┘
```

Wordmark: the mark plus "quarry" in IBM Plex Sans SemiBold, 17px, tracking -0.02em, 9px gap.
Minimum size 16px for the mark. Do not recolour the block, add effects, or set the wordmark
in another typeface.

## Typography

| Use | Face | Notes |
|---|---|---|
| Interface and prose | IBM Plex Sans 400 / 500 / 600 | 14px base for the app, 15px for answers |
| SQL, ids, values in tables | IBM Plex Mono 400 / 500 | 12-12.5px |
| Numeric columns | Plex with `font-variant-numeric: tabular-nums` | so digits align |

Plex is open source (SIL Open Font License) and was designed for technical interfaces; it
has clear figures and a mono companion that matches its proportions. Headings use weight
and size, never colour. Labels above sections are 11.5px, 600, uppercase, 0.06em tracking.

## Colour

Warm stone neutrals carry the interface; a deep verdigris (the green of weathered copper
in rock) is the single accent for actions, links, focus and the primary data series.
Status colours are reserved for state and always come with an icon and a label.

### Light

| Token | Hex | Use | Contrast |
|---|---|---|---|
| `--bg` | `#f7f6f3` | page | |
| `--surface` | `#ffffff` | cards, panels, top bar | |
| `--surface-2` | `#f1efea` | table headers, hover | |
| `--border` | `#e2dfd8` | hairlines | |
| `--text` | `#1c1b19` | primary text | 15.9:1 on page |
| `--text-2` | `#5b5850` | secondary text | 6.6:1 on page |
| `--text-3` | `#6f6b62` | labels, captions | 4.9:1 on page (AA) |
| `--accent` | `#0e6b58` | actions, links, focus | 6.0:1 on page, 6.4:1 on white |
| `--danger` | `#a3352b` | errors | |
| `--warning` | `#7d5300` | warnings | |
| `--ok` | `#2b6b3d` | success | |

### Dark

Dark mode is designed, not inverted: the same hues, re-stepped for a near-black stone
surface (`#1a1a19`). Accent `#4fc3a6` (7.8:1), secondary text `#b9b7af` (7.5:1), labels
`#9a978e` (above 5:1). The theme follows the operating system and can be set by the user.

## Data visualisation

Charts use a six-slot categorical palette, assigned in a fixed order and never cycled; a
seventh series is folded into "Other" by the chart tool. The palette was checked with a
validator for lightness band, chroma, colour-vision-deficiency separation between adjacent
slots, normal-vision separation and contrast, in both modes:

| Slot | Light | Dark |
|---|---|---|
| 1 verdigris | `#12866f` | `#169a80` |
| 2 blue | `#2a78d6` | `#3987e5` |
| 3 orange | `#eb6834` | `#d95926` |
| 4 violet | `#6250d6` | `#9085e9` |
| 5 yellow | `#eda100` | `#c98500` |
| 6 magenta | `#e87ba4` | `#d55181` |

Results: all checks pass in light and dark. Slots 5 and 6 sit below 3:1 contrast on the light
surface, so every chart has a "Show data" table and tooltips, and text never uses series
colours. Marks follow fixed specs: bars at most 24px thick with 4px rounded ends, 2px lines,
8px points with a surface-coloured ring, hairline solid gridlines, one y-axis only.

## Layout and components

- 52px top bar; content column up to 860px; a 340px right rail that shows the dataset and
  guardrails, or the source of the number you clicked. On narrow screens the rail becomes a
  bottom sheet.
- Radii: 6px for controls, 10px for panels. Shadows only on the answer and the composer.
- Step cards are rows in one bordered list, not separate floating cards.
- Every state is designed: empty (examples and dataset facts), loading (activity line and
  skeletons), error (what happened, with a retry), refused, clarification (quick replies),
  rate-limited (when to try again) and provider back-off (a live countdown).

## What Quarry never uses

Gradients, glows, glassmorphism, sparkle or magic-wand icons, emoji, robot or brain
illustrations, generic three-up feature cards, stock photography, or colour as the only
signal.
