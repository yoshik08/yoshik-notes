# notes

Handwritten notes on an infinite page, in your browser. Made for Apple Pencil.

**Live:** https://yoshik.xyz/notes

## What it is

Write by hand on a page that never runs out, then find the note again in a library that shows every page as itself. Real vector ink (never screenshots), pressure from Apple Pencil, typed text, shapes, images, and a version history so nothing you wrote is lost.

## Stack

- **Frontend:** Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 + HTML Canvas
- **Backend:** Next.js route handlers over one store module (`lib/notes/store.ts`)
- **Database:** MongoDB Atlas
- **Auth:** NextAuth v4 + Google OAuth (httpOnly cookies)
- **Deploy:** Vercel (`yoshik-notes`), served at `yoshik.xyz/notes` through `yoshik-proxy`

## Apple Pencil

- The first `pointerType === "pen"` event turns on Pencil mode: the pen writes, fingers move the page, two fingers zoom.
- Without a pen, a finger writes (phones, finger-only iPads). Mouse works as usual; space-drag pans.
- Pressure comes from the Pencil; mouse and finger strokes get simulated pressure.

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
| `NEXTAUTH_URL` | `https://yoshik.xyz/notes/api/auth` in prod |

### Commands

```bash
npm run dev                         # dev server
npm run lint                        # eslint
npx tsc --noEmit                    # type check
npm run build && npm run test:e2e   # end-to-end tests (Playwright, in-memory MongoDB, /notes proxy replica)
```

## How it works

- **URLs:** every URL, assets included, is under `/notes` (see AGENTS.md). Local and production use the same paths.
- **Canvas:** world coordinates, high-DPI, one `requestAnimationFrame` loop, a cached layer for heavy pages. Ink is drawn with perfect-freehand.
- **Saving:** each edit is written to an IndexedDB journal, then sent as element ops (600 ms debounce, at most 3 s). Offline edits stay on the device and sync when the server is back. The last server copy is cached on the device, so notes open instantly.
- **Safety:** deletes go to Recently deleted for 30 days; the original of every note and recent versions are kept and can be restored.
- **Ownership:** derived from the session. Every route checks `ownerId`.

## API routes

All under `/notes/api`.

- `GET /health` (`?deep=1` also checks the database)
- `GET /me`
- `GET /notes` (`?trash=1` for Recently deleted), `POST /notes`
- `GET /notes/:id`, `PATCH /notes/:id` (element `ops`, title, settings, thumbnail, view; full `elements` with optional `baseRevision`), `DELETE /notes/:id` (`?permanent=1` from Recently deleted)
- `POST /notes/:id/restore`, `POST /notes/:id/duplicate`, `GET /notes/:id/thumb`
- `GET /notes/:id/versions`, `GET /notes/:id/versions/:vid`, `POST /notes/:id/versions/:vid/restore`

## Known limitations

- Apple Pencil detection uses `pointerType === "pen"`; browsers don't guarantee device identity.
- Handwriting isn't searchable; search covers titles and typed text.
- Images are resized on the device (2000 px longest side, about 1.2 MB) and stored in the note.
- SVG export wraps text per line, not automatically.
