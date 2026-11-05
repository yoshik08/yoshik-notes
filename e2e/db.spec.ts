import net from 'node:net';
import { test, expect } from '@playwright/test';
import { MongoMemoryServer } from 'mongodb-memory-server';

// A server instance whose first database connection failed must recover by
// itself once the database is reachable again (a failed MongoClient stays
// closed for good, so the app has to start a new one).

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

test('a failed first database connection is retried once the database is back', async () => {
  const port = await freePort();
  const before = process.env.MONGODB_URI;
  process.env.MONGODB_URI = `mongodb://127.0.0.1:${port}/`;
  const { getDb } = await import('../lib/db/mongo');
  let server: MongoMemoryServer | null = null;
  try {
    await expect(getDb()).rejects.toThrow();
    server = await MongoMemoryServer.create({ instance: { port } });
    const db = await getDb();
    expect((await db.command({ ping: 1 })).ok).toBe(1);
  } finally {
    await server?.stop();
    if (before === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = before;
  }
});
