'use client';

// Last-resort boundary for errors in the root layout itself.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" style={{ background: '#000' }}>
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#000', color: '#fff', font: '15px system-ui, sans-serif' }}>
        <div role="alert" style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ fontSize: 18, fontWeight: 600 }}>notes hit an error</p>
          <button
            type="button"
            onClick={reset}
            style={{ marginTop: 12, padding: '10px 18px', borderRadius: 999, border: 0, background: '#fff', color: '#000', fontWeight: 600, cursor: 'pointer' }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
