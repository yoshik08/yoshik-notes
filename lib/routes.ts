// Every URL the browser sees. The app always lives under /notes: yoshik-proxy
// forwards /notes/* here with the prefix stripped, and next.config.ts rewrites
// /notes/* the same way for direct access, so these work in every environment.
// Nothing else in the app should build a "/notes" string by hand.

export const BASE_PATH = '/notes';

export const routes = {
  home: () => BASE_PATH,
  note: (id: string) => `${BASE_PATH}/${encodeURIComponent(id)}`,
  newNote: () => `${BASE_PATH}/new`,
  trash: () => `${BASE_PATH}/trash`,
  authBase: `${BASE_PATH}/api/auth`,
  api: {
    notes: (query = '') => `${BASE_PATH}/api/notes${query}`,
    note: (id: string, query = '') => `${BASE_PATH}/api/notes/${encodeURIComponent(id)}${query}`,
    duplicate: (id: string) => `${BASE_PATH}/api/notes/${encodeURIComponent(id)}/duplicate`,
    restore: (id: string) => `${BASE_PATH}/api/notes/${encodeURIComponent(id)}/restore`,
    thumb: (id: string, version: number) => `${BASE_PATH}/api/notes/${encodeURIComponent(id)}/thumb?v=${version}`,
    versions: (id: string) => `${BASE_PATH}/api/notes/${encodeURIComponent(id)}/versions`,
    version: (id: string, vid: string) => `${BASE_PATH}/api/notes/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}`,
    restoreVersion: (id: string, vid: string) =>
      `${BASE_PATH}/api/notes/${encodeURIComponent(id)}/versions/${encodeURIComponent(vid)}/restore`,
  },
} as const;
