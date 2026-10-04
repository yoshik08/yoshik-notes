# notes

Premium infinite-canvas note-taking and drawing app. Made for Apple Pencil.

**Live:** https://www.yoshik.xyz/notes

## What it is

A browser-based alternative to Excalidraw/Notability for lightweight handwritten notes. Infinite canvas, real vector data (never screenshots), Apple Pencil support with finger-pan navigation.

## Stack

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind + HTML Canvas
- **Backend:** Next.js API routes
- **Database:** MongoDB Atlas
- **Auth:** NextAuth v4 + Google OAuth (httpOnly cookies)
- **Deploy:** Vercel (`yoshik-notes`), proxied via `yoshik-proxy` at `/notes`

## Apple Pencil behavior

- `pointerType === "pen"` detection triggers **Pencil Mode**
- Pen draws, one finger pans, two fingers pan + zoom
- Mouse works normally
- First detection shows a one-time toast: "Apple Pencil detected — pencil draws · fingers pan"

## Development

```bash
npm install
npm run dev
```

### Environment variables

| Var | Purpose |
|-----|---------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `NEXTAUTH_SECRET` | Session encryption |
| `NEXTAUTH_URL` | `https://www.yoshik.xyz/notes/api/auth` in prod |

### Key commands

```bash
npm run dev      # dev server
npm run build    # production build
npx tsc --noEmit # type check
```

## Architecture

- **Canvas:** World-coordinate system, high-DPI rendering, `requestAnimationFrame` loop. Transient pointer state kept out of React state for performance.
- **Data:** Notes store structured `elements[]` (stroke, line, arrow, rectangle, ellipse, text, image). `revision` increments on every write for conflict detection.
- **Autosave:** 800ms debounce after edits. Offline changes persist to IndexedDB and sync on reconnect.
- **Ownership:** Derived from session, never from client input. Every API route enforces `ownerId`.

## API routes

- `GET /api/me` — current user
- `GET /api/health` — health check
- `GET /api/notes` — list notes
- `POST /api/notes` — create note
- `GET /api/notes/:id` — get note
- `PATCH /api/notes/:id` — update (with `baseRevision` conflict detection)
- `DELETE /api/notes/:id` — delete
- `POST /api/notes/:id/duplicate` — duplicate

## Known limitations

- Apple Pencil detection uses `pointerType === "pen"` — browsers don't guarantee device identity
- iPad hardware verification pending (no device available for testing)
- Text wrapping in SVG export is per-line, not auto-wrap
- Images limited to 2MB, stored as data URLs (large libraries should use object storage)
