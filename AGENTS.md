# AGENTS.md — yoshik-notes

Premium browser-based note-taking and infinite-canvas drawing app.
Production: https://yoshik.xyz/notes

## Architecture

- **Stack**: Next.js (App Router) + TypeScript + Tailwind. Full-stack monolith.
  - Frontend: React, HTML Canvas for drawing
  - Backend: Next.js API routes (`app/api/`)
  - DB: MongoDB Atlas (`notes` database)
  - Auth: NextAuth v4 with Google OAuth, JWT sessions in httpOnly cookies
- **Why Next.js not Vite+Express**: Single deployment, proven with Attenly infra, Vercel-optimized.

## Key Conventions

- Canvas uses **world coordinates**; all elements stored in world space.
- Elements have stable `id`. Never store screenshots as document data.
- `revision` increments on every mutation; used for conflict detection.
- Ownership derived from session, never from client-supplied ownerId.
- Theme: pure AMOLED black `#000000` UI, white `#ffffff` canvas option.
- Accent: restrained amber `#E9A13B`.

## Development Commands

```bash
npm run dev      # local dev server
npm run build    # production build
npm run lint     # eslint
```

## Environment Variables

| Var | Purpose |
|-----|---------|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `NEXTAUTH_SECRET` | Session encryption |
| `NEXTAUTH_URL` | Must be `https://yoshik.xyz/notes/api/auth` in prod |

## Deployment Structure

- GitHub: `yoshik08/yoshik-notes`
- Vercel project: `yoshik-notes`
- Proxy: `yoshik-proxy` rewrites `/notes/:path*` → notes deployment
- Public URL: `https://yoshik.xyz/notes`

## Browser/Platform Limitations

- Apple Pencil detection via `pointerType === "pen"` — not guaranteed device identity.
- iOS Safari: test touch-action carefully; don't break scroll.
- `touch-action: none` only on canvas, not entire app.

## Data Model

**users**: `_id, googleId, email, name, avatar, createdAt, updatedAt`
Indexes: `googleId` (unique), `email`

**notes**: `_id, ownerId, title, elements[], appState, canvasSettings, revision, createdAt, updatedAt`
Indexes: `ownerId`, `updatedAt`

**Element types**: stroke, line, arrow, rectangle, ellipse, text, image
