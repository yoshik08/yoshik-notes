'use client';

import { signIn } from 'next-auth/react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CanvasElement } from '@/lib/db/models';
import type { Paper } from '@/lib/canvas/scene';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { Wordmark } from '@/components/brand/wordmark';
import { GreaseMark } from '@/components/library/grease-mark';
import { LiveInk } from './live-ink';
import { PageFrame } from './page-frame';

interface Example {
  title: string;
  paper: Paper;
  elements: CanvasElement[];
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

function SignInButton({ className, wrote }: { className?: string; wrote?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => void signIn('google', { callbackUrl: routes.home() })}
      className={cn('pressable inline-flex h-12 items-center gap-3 rounded-full bg-white pl-4 pr-5 text-[15px] font-semibold text-black hover:bg-white/92', className)}
    >
      <GoogleG />
      {wrote ? 'Continue with Google to keep it' : 'Continue with Google'}
    </button>
  );
}

function EdgeArrow() {
  return (
    <svg width="6" height="7" viewBox="0 0 6 7" aria-hidden="true" className="inline-block shrink-0">
      <path d="M0 0L6 3.5L0 7Z" fill="currentColor" />
    </svg>
  );
}

function ExampleFrame({ ex, n, replay, className }: { ex: Example; n: number; replay?: { delay: number; duration: number }; className?: string }) {
  return (
    <figure className={cn('develop flex min-w-0 flex-col', className)} style={{ ['--i' as string]: n }}>
      <div className={cn('aspect-[3/2] overflow-hidden rounded-[3px]', ex.paper.background === '#000000' && 'ring-1 ring-white/14')}>
        <PageFrame elements={ex.elements} paper={ex.paper} replay={replay} label={`Example note: ${ex.title}`} />
      </div>
      <figcaption className="type-edge mt-2 flex items-center gap-1.5 text-[11.5px]">
        <span>{n}</span>
        <EdgeArrow />
        <span className="truncate">Example: {ex.title}</span>
      </figcaption>
    </figure>
  );
}

function Section({ ex, n, title, children, flip }: { ex?: Example; n: number; title: string; children: React.ReactNode; flip?: boolean }) {
  return (
    <section className="grid items-center gap-x-14 gap-y-8 border-t border-white/10 py-16 sm:py-24 md:grid-cols-2">
      <div className={cn(flip && 'md:order-2')}>{ex ? <ExampleFrame ex={ex} n={n} /> : null}</div>
      <div className="max-w-[46ch]">
        <h2 className="type-display text-[clamp(30px,4vw,48px)] text-white">{title}</h2>
        <div className="mt-5 flex flex-col gap-4 text-[16px] leading-[1.6] text-text-2">{children}</div>
      </div>
    </section>
  );
}

/** Ink left on the live frame in an earlier visit (read from storage; false on the server). */
function useStoredInk() {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener('storage', fn);
      return () => window.removeEventListener('storage', fn);
    },
    () => {
      try {
        return !!JSON.parse(localStorage.getItem('notes:landing-ink') ?? 'null')?.strokes?.length;
      } catch {
        return false;
      }
    },
    () => false,
  );
}

export function Landing({ sessionTimedOut = false }: { sessionTimedOut?: boolean }) {
  const [examples, setExamples] = useState<Example[]>([]);
  const [hint, setHint] = useState<Array<{ points: Array<{ x: number; y: number; pressure?: number }> }>>();
  const [wroteNow, setWroteNow] = useState(false);
  const wrote = useStoredInk() || wroteNow;

  useEffect(() => {
    let alive = true;
    fetch(`${routes.home()}/landing/examples.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { examples: Example[]; hint?: Array<{ points: Array<{ x: number; y: number; pressure?: number }> }> } | null) => {
        if (!alive || !d) return;
        setExamples(d.examples);
        setHint(d.hint);
      })
      .catch(() => {
        /* the page works without examples */
      });
    return () => {
      alive = false;
    };
  }, []);

  const strip = examples.slice(0, 5);

  return (
    <div className="min-h-dvh bg-black text-white">
      {sessionTimedOut ? (
        <p className="type-edge bg-white/[0.06] px-4 py-2 text-center text-[12px]" role="status">
          Couldn’t check whether you’re signed in. You can sign in below.
        </p>
      ) : null}

      <div className="mx-auto max-w-[1440px] px-[max(1.25rem,env(safe-area-inset-left))] sm:px-10">
        <header className="flex items-center justify-between pt-6 pb-8 sm:pt-8">
          <Wordmark className="text-[24px]" />
          <button type="button" onClick={() => void signIn('google', { callbackUrl: routes.home() })} className="pressable rounded-full px-4 py-2 text-[14px] font-medium text-white/80 hover:bg-white/10 hover:text-white">
            Sign in
          </button>
        </header>

        <div className="flex flex-col">
        {/* The contact sheet: a strip of examples across the top. */}
        <div className="order-2 -mx-[max(1.25rem,env(safe-area-inset-left))] overflow-x-auto pb-16 md:order-1 md:pb-0 px-[max(1.25rem,env(safe-area-inset-left))] [scrollbar-width:none] sm:mx-0 sm:px-0">
          <div className="grid min-w-[720px] grid-cols-5 gap-[var(--frame-gap)]" aria-label="Example notes">
            {strip.length
              ? strip.map((ex, i) => <ExampleFrame key={ex.title} ex={ex} n={i + 1} replay={{ delay: 250 + i * 160, duration: 1500 }} />)
              : Array.from({ length: 5 }).map((_, i) => <div key={i} className="aspect-[3/2] rounded-[3px] bg-white/[0.05]" />)}
          </div>
        </div>

        {/* First viewport: the live frame, circled, beside the headline. */}
        <section className="order-1 grid items-center gap-x-14 gap-y-12 pt-2 pb-16 md:order-2 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:pt-14 md:pb-20">
          <figure className="develop relative order-2 md:order-1" style={{ ['--i' as string]: 6 }}>
            <div className="relative aspect-[3/2] w-full">
              <LiveInk onFirstStroke={() => setWroteNow(true)} hint={hint} />
              <GreaseMark show seed="the-live-frame" gap={14} width={4.4} />
            </div>
            <figcaption className="type-edge mt-7 flex items-center gap-1.5 text-[12px]">
              <span>6</span>
              <EdgeArrow />
              <span className="text-white/70">{wrote ? 'Yours. Sign in to keep it.' : 'Try it: write here with a pencil, finger, or mouse'}</span>
            </figcaption>
          </figure>

          <div className="develop order-1 md:order-2" style={{ ['--i' as string]: 7 }}>
            <h1 className="type-display text-[clamp(40px,4.3vw,72px)] text-white">
              <span className="block md:whitespace-nowrap">Write by hand.</span>
              <span className="block md:whitespace-nowrap">Keep every page.</span>
            </h1>
            <p className="mt-6 max-w-[42ch] text-[17px] leading-[1.6] text-text-2">
              A notebook in your browser, made for Apple Pencil. The page never runs out, your ink syncs through your Google account, and nothing you write gets lost.
            </p>
            <SignInButton className="mt-8" wrote={wrote} />
            <p className="type-edge mt-4 text-[12px]">Built for Safari on iPad, and for desktop browsers.</p>
          </div>
        </section>
        </div>

        <Section ex={examples[0]} n={7} title="Ink that feels like ink.">
          <p>Pencil pressure becomes line weight, so letters thicken where you press and taper where you lift. A tap leaves a dot. With a finger or a mouse, your speed shapes the line instead.</p>
          <p>Ink is stored as vectors, never as a picture, so it stays sharp at any zoom.</p>
        </Section>

        <Section ex={examples[3]} n={8} title="The page never runs out." flip>
          <p>Pinch to go from one word to the whole map. Two fingers move the page while the pencil keeps writing, and your palm stays out of it.</p>
          <p>White paper or black, blank, dotted, squared, or lined.</p>
        </Section>

        <Section ex={examples[2]} n={9} title="Nothing gets lost.">
          <p>Every stroke is saved on your device first, then synced. Lose the Wi‑Fi in a lecture hall and keep writing; it catches up when you’re back.</p>
          <p>Earlier versions of each note are kept, and deleted notes wait 30 days before they’re gone.</p>
        </Section>

        <Section ex={examples[4]} n={10} title="Bring anything in." flip>
          <p>Paste a screenshot or drop a photo, then circle what matters. Type when typing is faster, and draw arrows, boxes, and lines that stay straight.</p>
          <p>Export a page as PNG, as SVG, or as a file you can import again.</p>
        </Section>

        <section className="flex flex-col items-start gap-8 border-t border-white/10 py-20 sm:py-28 md:flex-row md:items-end md:justify-between">
          <h2 className="type-display max-w-[14ch] text-[clamp(36px,5vw,64px)] text-white">Your next page is blank.</h2>
          <SignInButton wrote={wrote} />
        </section>

        <footer className="type-edge flex flex-wrap items-center justify-between gap-3 border-t border-white/10 py-8 text-[12px]" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>
          <span>notes, part of yoshik.xyz</span>
          <a href="https://yoshik.xyz" className="hover:text-white">
            yoshik.xyz
          </a>
        </footer>
      </div>
    </div>
  );
}
