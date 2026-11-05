import type { Metadata, Viewport } from "next";
import { Archivo, Geist } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

// Archivo carries the display voice (wide) and the film edge-print (condensed);
// Geist is the interface face. Both are self-hosted by next/font.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });

export const metadata: Metadata = {
  title: { default: "notes", template: "%s · notes" },
  description: "Handwritten notes on an infinite page, in your browser. Made for Apple Pencil.",
  manifest: "/notes/manifest.json",
  applicationName: "notes",
  appleWebApp: { capable: true, title: "notes", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/notes/icon.svg", type: "image/svg+xml" }, { url: "/notes/icon-192.png", sizes: "192x192" }],
    apple: "/notes/icon-192.png",
  },
  openGraph: {
    title: "notes",
    description: "Handwritten notes on an infinite page, in your browser. Made for Apple Pencil.",
    url: "https://yoshik.xyz/notes",
    siteName: "notes",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
};

// Runs before (and independently of) the app bundle. If a script or the
// stylesheet fails to load, or the app has not started within 10s, show a
// real error with a reload button instead of an empty page.
const BOOT_WATCHDOG = `(function(){
  function fail(){
    if (document.documentElement.dataset.booted || document.getElementById('boot-fail')) return;
    var d = document.createElement('div');
    d.id = 'boot-fail';
    d.setAttribute('role', 'alert');
    d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#000;color:#fff;font:15px/1.5 system-ui,-apple-system,sans-serif;text-align:center;padding:24px;z-index:2147483647';
    d.innerHTML = '<strong style="font-size:18px">notes couldn\\u2019t load</strong><span style="color:#9a9a9a">Part of the app didn\\u2019t arrive. Check your connection and try again.</span><a href="" style="margin-top:6px;padding:10px 18px;border-radius:999px;background:#fff;color:#000;text-decoration:none;font-weight:600">Reload</a>';
    document.body.appendChild(d);
  }
  addEventListener('error', function(e){
    var t = e.target;
    if (t && (t.tagName === 'SCRIPT' || (t.tagName === 'LINK' && t.rel === 'stylesheet'))) fail();
  }, true);
  setTimeout(fail, 10000);
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${geist.variable} h-full antialiased`} style={{ background: "#000" }}>
      <body className="min-h-full bg-black text-white" style={{ background: "#000", color: "#fff" }}>
        <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
