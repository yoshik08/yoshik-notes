// Local replica of how yoshik-proxy routes this app in production
// (github.com/yoshik08/yoshik-proxy, vercel.json):
//   /notes          -> app /
//   /notes/         -> app /
//   /notes/:path*   -> app /:path*      (the /notes prefix is stripped)
//   anything else   -> another site, so it is never the notes app (404 here)
// Running the e2e suite through this proxy catches any URL the app emits
// without the /notes prefix, which is exactly what blanked production.
import http from 'node:http';

export function startProxy({ port, appOrigin }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://proxy.local');
    let upstreamPath = null;
    if (url.pathname === '/notes' || url.pathname === '/notes/') upstreamPath = '/';
    else if (url.pathname.startsWith('/notes/')) upstreamPath = url.pathname.slice('/notes'.length);

    if (upstreamPath === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('The page could not be found (not routed to notes)');
      return;
    }

    const target = new URL(upstreamPath + url.search, appOrigin);
    const headers = { ...req.headers, host: target.host, 'x-forwarded-host': req.headers.host ?? '', 'x-forwarded-proto': 'http' };
    const upstream = http.request(target, { method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`proxy upstream error: ${e.message}`);
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
