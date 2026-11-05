// Boots the production build the way it runs live: a throwaway MongoDB,
// `next start`, and the yoshik-proxy replica in front of it.
// Requires `npm run build` first. Used as Playwright's webServer.
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { startProxy } from './proxy.mjs';
import { APP_PORT, PROXY_PORT, E2E_SECRET } from './env.mjs';

const mongo = process.env.E2E_MONGODB_URI ? null : await MongoMemoryServer.create();
const mongoUri = process.env.E2E_MONGODB_URI ?? mongo.getUri();

const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(APP_PORT)], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    MONGODB_URI: mongoUri,
    NEXTAUTH_SECRET: E2E_SECRET,
    NEXTAUTH_URL: `http://localhost:${PROXY_PORT}/notes/api/auth`,
    GOOGLE_CLIENT_ID: 'e2e-client',
    GOOGLE_CLIENT_SECRET: 'e2e-secret',
  },
});

await startProxy({ port: PROXY_PORT, appOrigin: `http://localhost:${APP_PORT}` });
console.log(`[e2e] proxy http://localhost:${PROXY_PORT}/notes -> app :${APP_PORT}, mongo ${mongo ? 'in-memory' : 'external'}`);

const shutdown = async () => {
  app.kill();
  await mongo?.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
app.on('exit', (code) => {
  console.log(`[e2e] next exited with ${code}`);
  void mongo?.stop().finally(() => process.exit(code ?? 1));
});
