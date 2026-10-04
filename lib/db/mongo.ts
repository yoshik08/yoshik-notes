import { MongoClient, Db } from 'mongodb';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  if (!client) {
    client = new MongoClient(uri);
    await client.connect();
  }
  db = client.db('notes');
  return db;
}

export async function ensureIndexes() {
  const database = await getDb();
  await database.collection('users').createIndex({ googleId: 1 }, { unique: true });
  await database.collection('users').createIndex({ email: 1 });
  await database.collection('notes').createIndex({ ownerId: 1 });
  await database.collection('notes').createIndex({ updatedAt: -1 });
  await database.collection('notes').createIndex({ ownerId: 1, updatedAt: -1 });
}
