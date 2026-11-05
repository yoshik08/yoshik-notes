'use client';

// Any render error below the root layout lands here instead of a blank page.
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="flex min-h-screen flex-col items-center justify-center gap-3 bg-black px-6 text-center text-white">
      <p className="text-lg font-semibold">Something went wrong</p>
      <p className="max-w-sm text-sm text-neutral-400">{error.message || 'An unexpected error occurred.'}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition hover:bg-neutral-200"
      >
        Try again
      </button>
    </div>
  );
}
