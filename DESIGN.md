# Vouch design system

**Idea:** a real person's one-sentence reason a video is worth your hour. The interface is paper
and ink; the loud gesture is the **highlighter** across what someone said. Everything else stays
quiet so the quotes carry the page.

Direction: editorial product site (large grotesk headlines, serif-italic quotes, generous space),
light and dark. Not based on a comparison of real sites (no reference library was connected);
built from the existing brand.

Tokens live in `app/globals.css` (`:root`, dark values under `prefers-color-scheme: dark`).
Pages use the names, never raw values.

## Colour

Two themes, following the system setting. Light is paper and pen blue. Dark is true black with no blue tint: white is the action colour, and yellow appears only where something is being vouched for.

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--paper` | #f6f7f9 | #050505 | Page canvas |
| `--surface` | #ffffff | #0e0e0f | Raised panels, inputs, menus |
| `--sunk` | #eef0f4 | #171718 | Wells, placeholders, hover fills |
| `--ink` | #151a30 | #f6f6f4 | Headings, body text |
| `--ink-2` | #3a4060 | #d2d2cf | Secondary text |
| `--muted` | #5f667e | #a3a3a0 | Captions, meta (≥4.5:1 on paper) |
| `--rule` / `--rule-strong` | #dfe2e9 / #c5cad6 | #232325 / #38383b | Dividers, borders |
| `--pen` | #1f3bb3 | #ffffff | Primary: buttons, links, focus, selected |
| `--pen-deep` | #172c8a | #ffd84d | Hover of primary |
| `--pen-soft` | #e9edfb | #1d1d1f | Selected backgrounds |
| `--on-pen` | #ffffff | #050505 | Text on `--pen` |
| `--mark` / `--mark-band` | #ffd84d | #ffd84d | Highlighter: logo tile, highlighted quotes |
| `--on-mark` | #151a30 | #0a0a0a | Text on the highlighter |
| `--hl-size` | 0.62em | 1.08em | Light underlines the lower part of a line; dark fills the whole line |
| `--logo-ink` | #1f3bb3 | #0a0a0a | Quote marks in the logo tile |
| `--worth` / `--miss` | #146c45 / #a3271b | #5fd39b / #ff9a8a | Worth it / not worth it, success / error |
| `--gloss` | none | white 4.5% → 0 | Dark only: top-lit sheen on raised surfaces |

## Typography

- **Schibsted Grotesk** (sans, 400–900): UI, headings, numbers. Headlines 750–850 with tight
  tracking (−0.03 to −0.05em).
- **Newsreader** (serif, italic): quotes only. A quote is the one place the serif appears.
- Scale (rem): 0.75 · 0.875 · **1 (body)** · 1.125 · 1.3125 · 1.5 · 1.875 · 2.25 · 3 · display
  `clamp(2.4rem, 5.4vw, 4.4rem)`. Body line height 1.55; quotes 1.22–1.42; headings 1–1.25.
- Line length 60–75 characters (`--read: 42rem`).

## Spacing and layout

4px base: 4, 8, 12, 16, 24, 32, 48, 64, 96. Content width `--shell: 74rem` with 24px gutters.
Sections 48–96px apart. Left-aligned; nothing centred except empty states.

## Shape, depth, motion

- Radius: `--r-sm` 6px (buttons, inputs), `--r-md` 10px (thumbnails), `--r-lg` 14px (panels),
  999px (chips, stamps).
- Elevation: `--shadow-1` (hairline under raised panels), `--shadow-2` (the one hero panel, menus).
- Motion: 140ms colour/press feedback, 240ms reveals, one 900ms highlighter draw-in on the home
  hero. `prefers-reduced-motion: reduce` removes all of it.

## Components

- **Buttons:** primary (`--pen` fill), ghost (surface + border), quiet (text). Hover darkens,
  press nudges 1px down, focus shows a 2px `--pen` ring with 3px offset, disabled at 45% opacity.
- **Header:** sticky, translucent `--paper` with backdrop blur, hairline when scrolled.
- **Chips:** pill links for filters; selected = `--pen` fill.
- **Stamp:** "Vouched N×" outlined pill in `--pen`, only with real counts.
- **Quote:** serif italic, blue hanging quotation marks, credit line naming the commenter and
  linking the comment. The lead quote gets the highlighter band.
- **Pick row:** 16:9 thumbnail with runtime, quote, credit, title, facts, stamp. Rows divided by
  rules, not boxed cards.
- **Proof strip:** real catalogue numbers (videos, comments, channels, latest month), no invented
  stats.
- **Empty states:** say what's missing and offer one next step.

## Imagery and icons

YouTube thumbnails only (16:9, rounded `--r-md`). Icons: simple 1.8px-stroke inline SVG; no
emoji as icons, no stock illustration. Logo: highlighter tile with an ink-blue quotation mark
(`app/components/Logo.tsx`, `app/icon.svg`).
