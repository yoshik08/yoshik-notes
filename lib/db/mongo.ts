import { MongoClient, Db } from 'mongodb';

// One client per server instance. The connect attempt itself is shared, so
// requests arriving together use one connection. If it fails, it is forgotten:
// a client whose first connect failed stays closed for good ("Topology is
// closed"), so the next request must start a fresh one, or one bad moment
// would break this instance until it is recycled.
let connecting: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!connecting) {
    const uri = process.env.MONGODB_URI;
    if (!uri) return Promise.reject(new Error('MONGODB_URI is not set'));
    // Fail in seconds, not the driver's default 30s, so the UI shows an error instead of hanging.
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    connecting = client.connect().then(
      () => client.db('notes'),
      (e) => {
        connecting = null;
        void client.close().catch(() => {});
        throw e;
      },
    );
  }
  return connecting;
}

export async function ensureIndexes() {
  const database = await getDb();
  await database.collection('users').createIndex({ googleId: 1 }, { unique: true });
  await database.collection('users').createIndex({ email: 1 });
  await database.collection('notes').createIndex({ ownerId: 1 });
  await database.collection('notes').createIndex({ updatedAt: -1 });
  await database.collection('notes').createIndex({ ownerId: 1, updatedAt: -1 });
}
