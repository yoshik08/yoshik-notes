# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anyone with a Google account (public product, confirmed 2026-11-05). The primary situation is an iPad with Apple Pencil in Safari; laptops with a trackpad or mouse are the second context. People keep every kind of note here: handwritten lecture notes, diagrams and sketches, screenshots or photos they annotate, and quick thoughts and lists.

## Product Purpose

notes is a browser-based notebook with an infinite canvas: write and draw by hand, drop in images, and type when typing is faster. It exists so handwritten thinking lives somewhere that opens instantly on any device, without an app install, and is never lost. Success means a person can open yoshik.xyz/notes, start writing within a second, and trust that every stroke is still there tomorrow.

## Positioning

Pencil-first handwriting in the browser: real vector ink with pressure, an infinite canvas, and sync through the person's Google account, with no install. Notes export as PNG, SVG, or editable JSON.

## Operating Context

- iPad Safari with Apple Pencil: the pencil draws, one finger pans, two fingers pan and zoom.
- Desktop browsers: mouse or trackpad draw; wheel and pinch pan and zoom; keyboard shortcuts.
- Connections drop (classrooms, travel): edits must survive going offline and reloading.
- Served at https://yoshik.xyz/notes through yoshik-proxy, which forwards /notes/* to this app with the /notes prefix stripped.

## Capabilities and Constraints

- Notes are vector documents: elements (stroke, line, arrow, rectangle, ellipse, text, image) in world coordinates, stored in MongoDB Atlas (`notes` database) with a `revision` per note.
- Existing stored notes must keep loading and must never be lost or silently rewritten; schema changes are additive only.
- Sign-in is Google via NextAuth (JWT session cookie); ownership comes from the session, never from client input.
- Deployed on Vercel (Git-connected, `main` deploys production). Request bodies are capped at 4.5 MB by the platform.
- Images are stored inline as data URLs (no object storage yet), so they must be compressed client-side.

## Brand Commitments

- Name: "notes", lowercase, living at yoshik.xyz/notes.
- The owner's standing direction for their products: true-black (AMOLED #000) interface, Apple-like quiet chrome, premium typography, nothing that reads as AI-generated.

## Evidence on Hand

No testimonials, user counts, reviews, or benchmarks exist. Do not invent any.

## Product Principles

1. Never lose ink: every edit is saved locally first and synced after; deletes are recoverable.
2. Pencil first, never pencil only: everything works with touch, mouse, trackpad, and keyboard.
3. Instant: opening, writing, and saving never wait on the network.
4. The ink is the content: chrome stays quiet and out of the way of the page.

## Accessibility & Inclusion

Keyboard access for every non-drawing action, visible focus, reduced-motion support, and readable contrast on the black interface.
