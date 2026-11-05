// Shared settings for the e2e harness. Test-only values for a throwaway server.
export const PROXY_PORT = Number(process.env.E2E_PROXY_PORT ?? 3100);
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3101);
export const BASE_URL = `http://localhost:${PROXY_PORT}/notes`;
export const E2E_SECRET = 'e2e-only-secret-do-not-use-anywhere-else-0123456789';
// NextAuth's default name over plain http (production over https uses __Secure-next-auth.session-token).
export const SESSION_COOKIE = 'next-auth.session-token';
// Relative to the repo root, which is the cwd for both Playwright and e2e/serve.mjs.
export const RUNTIME_FILE = 'e2e/.runtime.json';
