import { getDb } from '@/lib/db/mongo';

// GET /api/health — liveness; ?deep=1 also pings the database (no data is read)
export async function GET(req: Request) {
  const ts = new Date().toISOString();
  if (new URL(req.url).searchParams.get('deep') !== '1') return Response.json({ ok: true, ts });
  const started = Date.now();
  try {
    await (await getDb()).command({ ping: 1 });
    return Response.json({ ok: true, ts, db: 'up', ms: Date.now() - started });
  } catch (e) {
    // The reason goes to the server log only; the public answer stays generic.
    console.error('[notes] database ping failed', e);
    return Response.json({ ok: false, ts, db: 'down', ms: Date.now() - started }, { status: 503 });
  }
}
