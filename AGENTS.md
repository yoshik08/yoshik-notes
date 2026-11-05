# AGENTS.md — yoshik-notes

Handwritten notes on an infinite page, in the browser. Made for iPad + Apple Pencil, works with mouse and touch.
Production: https://yoshik.xyz/notes

## Architecture

- **Stack**: Next.js 16 (App Router, Turbopack) + React 19 + TypeScript + Tailwind v4. One deployment.
  - Backend: route handlers in `app/api/`, thin; all note logic is in `lib/notes/store.ts`.
  - DB: MongoDB (`notes` database): `users`, `notes`, `note_versions`.
  - Auth: NextAuth v4, Google OAuth, JWT sessions in httpOnly cookies.
  - UI: shadcn (Radix) in `components/ui`, Phosphor icons, sonner toasts, GSAP (Flip) and anime.js for motion.
- **Map**
  - `lib/routes.ts` — every URL the client uses. Use it; never hand-write `/notes/...` or `/api/...`.
  - `lib/notes/` — server store (validation, element ops, trash, versions, thumbnails).
  - `lib/sync/` — client sync for one open note (IndexedDB journal + offline copy, debounced element-op saves).
  - `lib/canvas/` — `engine.ts` (input, history, camera, render loop), `scene.ts` (drawing, thumbnails), `ink.ts` (perfect-freehand strokes), `camera.ts` (springs, fling).
  - `components/library`, `components/editor`, `components/landing` — the three screens.
- **Design**: `DESIGN.md` (tokens and rules) and `PRODUCT.md` (who it's for). Read both before UI work.

## URLs: everything lives under /notes

yoshik-proxy forwards `yoshik.xyz/notes/:path*` to this app **with the `/notes` prefix stripped**; every other path on yoshik.xyz goes to a different site. So:

- `assetPrefix: "/notes"` makes `/_next/*` assets load as `/notes/_next/*` (without it the page is blank behind the proxy).
- `beforeFiles` rewrites in `next.config.ts` map `/notes/*` back to `/*`, so localhost and `*.vercel.app` use the same URLs as production.
- Do not add `basePath`, and do not sniff hostnames.

## Data safety (hard rules)

- Never lose a note. Deleting moves to Recently deleted (`deletedAt`, purged after 30 days); only a delete from there is permanent.
- The first edit of a note keeps the original as a version; later versions are kept at most every 15 min, last 10.
- The editor saves element ops (`{ upsert, delete }`), applied atomically on the server. Full `elements` replace is for import and restore only.
- Unknown element fields pass through untouched. Old notes are normalised on read only.
- Every local edit is in the IndexedDB journal before it is sent, and leaves only after the server confirms it.
- Thumbnails and view position are not edits: no revision bump, no reordering.

## Key conventions

- Canvas uses **world coordinates**; elements have stable `id`s. Never store screenshots as document data.
- Ownership comes from the session, never from the client.
- Pencil-first input: pen draws, fingers pan and pinch. Without a pen, a finger draws.
- Colours: true black ground `#000000`; pages are white or black paper; the one accent is grease red `#ff4d3a`, for marks only (see DESIGN.md).

## Commands

```bash
npm run dev                         # local dev server
npm run lint                        # eslint (React Compiler rules on)
npx tsc --noEmit                    # type check
npm run build && npm run test:e2e   # e2e: production build, in-memory MongoDB, /notes proxy replica
```

The e2e suite (`e2e/`) is the gate for any change to saving, loading or URLs.

## Environment variables

| Var | Purpose |
|-----|---------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `NEXTAUTH_SECRET` | Session encryption |
| `NEXTAUTH_URL` | Must be `https://yoshik.xyz/notes/api/auth` in prod |

## Deployment

- GitHub: `yoshik08/yoshik-notes`; Vercel project `yoshik-notes` deploys `main` to production on push.
- Proxy: `yoshik-proxy` rewrites `/notes/:path*` → `yoshik-notes.vercel.app/:path*`.
- Public URL: `https://yoshik.xyz/notes`. After a deploy, check `/notes/api/health?deep=1`.

## Data model

**users**: `_id, googleId, email, name, avatar, createdAt, updatedAt` — indexes `googleId` (unique), `email`

**notes**: `_id, ownerId, title, elements[], appState, canvasSettings { background, pattern }, revision, createdAt, updatedAt, deletedAt, thumb, thumbType, thumbAt` — indexes `ownerId`, `updatedAt`

**note_versions**: `_id, noteId, ownerId, revision, title, elements[], canvasSettings, reason, createdAt` — one `original` per note is kept for good

**Element types**: stroke, line, arrow, rectangle, ellipse, text, image
