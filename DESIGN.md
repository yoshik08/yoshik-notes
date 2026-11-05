---
name: notes
description: Handwritten notes on an infinite page; a darkroom contact sheet on true black.
colors:
  ground: "#000000"
  ink-white: "#ffffff"
  grease: "#ff4d3a"
  alarm: "#ff6b81"
  surface-raised: "#111111"
  surface-sheet: "#0b0b0b"
  text-secondary: "rgba(255,255,255,0.64)"
  text-edge: "rgba(255,255,255,0.48)"
  hairline: "rgba(255,255,255,0.10)"
  dock: "rgba(16,16,16,0.78)"
  paper-light: "#ffffff"
  paper-dark: "#000000"
typography:
  display:
    fontFamily: "Archivo, Geist, sans-serif"
    fontSize: "clamp(40px, 4.3vw, 72px)"
    fontWeight: 620
    lineHeight: 0.98
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Archivo, Geist, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.015em"
  edge:
    fontFamily: "Archivo, Geist, sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.02em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0em"
rounded:
  frame: "3px"
  menu-item: "10px"
  card: "12px"
  menu: "16px"
  dialog: "22px"
  pill: "999px"
spacing:
  frame-gap: "clamp(14px, 2.2vw, 28px)"
  gutter: "16px"
  gutter-wide: "40px"
components:
  button-primary:
    backgroundColor: "{colors.ink-white}"
    textColor: "{colors.ground}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-white}"
    rounded: "{rounded.pill}"
    height: "40px"
  dock:
    backgroundColor: "{colors.dock}"
    rounded: "{rounded.pill}"
  tool-button:
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.pill}"
    size: "44px"
  tool-button-active:
    backgroundColor: "rgba(255,255,255,0.17)"
    textColor: "{colors.ink-white}"
  menu:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink-white}"
    rounded: "{rounded.menu}"
  frame:
    rounded: "{rounded.frame}"
    typography: "{typography.title}"
---

# Design System: notes

## Overview

**Creative North Star: "The contact sheet"**

notes looks like a darkroom contact sheet: a total-black sheet holding frames, and every frame is one of your pages exactly as it renders, white paper or black. The ink is the content and the only thing allowed to be loud. Chrome is quiet, translucent where it floats over a page, and set in a type system borrowed from film packaging and edge print.

Picking something is a red grease-pencil loop drawn around it, the way photographers circle keepers on a contact sheet. Opening a note is the enlarger: its frame grows into the page. These two moves, plus frames "developing" out of black on first load, are the whole motion language.

**Key Characteristics:**
- True black ground, never a tinted near-black.
- Frames are real renders of notes at 3:2 (35mm), with tabular edge-print numerals in shooting order.
- One accent, grease-pencil red, used only for marks: selection, the live frame, focus.
- White only for ink, content, and the single primary action.
- Translucent material only where chrome floats over a page (the editor dock and bars).

## Colors

### Primary
- **Grease (#ff4d3a):** the mark. Selection loops and boxes, the circled live frame on the landing page, focus rings, text selection, the caret. Never a fill for buttons or surfaces.

### Neutral
- **Ground (#000000):** every page background.
- **Ink white (#ffffff):** headlines, titles, the primary action pill, and ink on dark paper.
- **Text secondary (white 64%)** for body copy; **edge (white 48%)** for edge-print metadata. Both clear 4.5:1 on black.
- **Surface raised (#111111):** menus, popovers and sheets. Opaque, because they float over white paper too.
- **Alarm (#ff6b81):** destructive actions only, always with a text label.

### Named Rules
**The White Is Earned Rule.** A white fill marks the one primary action on a screen (New note, Continue with Google). Selected states use a lifted fog (white 17%), never solid white.

**The Ink Adapts Rule.** Black and white ink adapt to the paper at render time (black writes white on dark paper). Stored colours never change.

## Typography

**Display Font:** Archivo at width 120, weight 620 (self-hosted, variable).
**Title Font:** Archivo at width 112, weight 600.
**Edge Font:** Archivo at width 75, weight 500, tabular figures.
**Body Font:** Geist.

**Character:** a wide engineered grotesque, like the type on a film box, over a calm interface sans. Archivo's width axis carries both the expanded display voice and the condensed edge print, so one family plays both roles.

### Hierarchy
- **Display** (620, clamp(40px, 4.3vw, 72px), 0.98, −0.03em): landing headlines; one sentence per line.
- **Section** (620, clamp(30px, 4vw, 48px)): landing section headings.
- **Title** (600, 15–22px, −0.015em): note titles, page titles, empty and error state headings.
- **Body** (400, 14–17px, 1.6): copy, capped near 46ch.
- **Edge** (500, 11.5–12px, +0.02em, tabular): frame numbers, dates, counts, captions under frames.

### Named Rules
**The Edge Print Rule.** Metadata lives under its frame in edge print: number, film-edge arrow, date, count. No labels above headings, no middle-dot strings.

## Layout

The library is a contact sheet: a grid of 3:2 frames, two columns on phones up to five from 1280px, separated by `frame-gap`. The landing page's first viewport is a strip of example frames above an enlarged live frame beside the headline. On phones the headline and action come first. The editor is a full-bleed canvas with chrome floating at the edges, inside the safe areas.

## Elevation & Depth

Depth comes from material, not shadow stacks. Floating chrome uses a dark translucent material (78% #101010, 22px backdrop blur, a 1px light top edge, and one soft offset shadow). Menus and sheets are opaque raised surfaces. Cards are never used as page structure.

### Named Rules
**The Float Only Over Paper Rule.** Translucency appears only where chrome sits over a page. The library header and sheets over black use solid or near-solid surfaces.

## Shapes

Frames keep a 3px corner (prints, not cards). Controls are pills. Menus are 16px with 10px items; dialogs are 22px. The grease mark is drawn, never boxed: a loose rounded loop with variable width that overshoots its start.

## Components

### Buttons
- **Primary:** white pill, black text, 40–48px tall; `scale(0.96)` on press over 160ms.
- **Ghost:** transparent pill with white text and a fog hover. Used for every secondary action.

### Navigation
The library header holds the wordmark, frame count, search (`/` or ⌘K), sort (Recent / Created / A–Z) as a lifted-fog segmented control, Select, New note, and the account menu. The editor top bar holds back, the editable title, sync status, undo/redo, and the note menu.

### Frame (signature)
A note's own page, rendered by the canvas renderer and stored as a 480×320 image. Below it sit the title, then edge print. Frames for old notes "develop" a preview the first time they're shown.

### Grease mark (signature)
A hand-drawn red loop around a picked frame: a rounded-rectangle path with low-frequency wobble, rendered as variable-width ink and revealed along its centreline (360ms, ease-out) the first time it appears.

### Dock
The editor's tool bar: material pill with 44px tool buttons; the active tool uses Phosphor's fill weight on a lifted fog. The ink tray rises from it for colours, widths and shapes, and switches instantly when the change came from a key.

## Do's and Don'ts

### Do:
- **Do** keep the ground #000000 everywhere.
- **Do** show notes as their real rendered pages; never a placeholder icon for content.
- **Do** use grease red only for marks: selection, the live frame, focus.
- **Do** keep keyboard-driven changes instant, and UI motion under 300ms (page transitions excepted).
- **Do** honour reduced motion: develop becomes a short fade, glides become cuts.

### Don't:
- **Don't** fill selected states with solid white; that is reserved for the primary action.
- **Don't** add eyebrow labels, middle-dot meta strings, or emoji icons.
- **Don't** add drop-shadow glows to buttons or decorative gradients.
- **Don't** imitate materials (paper grain, film sprockets) in CSS; the frames are the material.
