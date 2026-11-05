import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/components/auth-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "notes",
  description: "Premium infinite-canvas notes. Draw, write, and think.",
  manifest: "/notes/manifest.json",
  appleWebApp: {
    capable: true,
    title: "notes",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/notes/icon-192.png",
    apple: "/notes/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ background: "#000" }}
    >
      <body className="min-h-full flex flex-col bg-black text-white" style={{ background: "#000", color: "#fff" }}>
        <script dangerouslySetInnerHTML={{ __html: BOOT_WATCHDOG }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
