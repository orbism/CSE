import type { Metadata } from "next";
import "./globals.css";
import { Footer } from "@/components/Footer";
import { Masthead, Rule } from "@/components/Masthead";
import { RadioStrip } from "@/components/RadioStrip";
import { THEME_BOOT } from "@/components/ThemeSwitch";
import { Providers } from "./providers";

const TITLE = "Cubic Symmetry Engine";
const DESCRIPTION =
  "512 generative works, each visualising the algebraic structure of one cubic equation: roots, discriminant, and threefold symmetry.";

/**
 * Canonical origin, for resolving the OpenGraph image to an absolute URL —
 * scrapers will not follow a relative one.
 *
 * Vercel supplies the production domain at build time, so a normal deploy needs
 * no configuration; `NEXT_PUBLIC_SITE_URL` overrides it for any other host. The
 * localhost fallback only ever applies to a local run, where nothing is
 * scraping anyway.
 */
const origin =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(origin),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  // favicon.svg is the ω-triad (a cubic's three roots), repainted live in the
  // current scheme's colours by ThemeSwitch. og.png is the wordmark rasterised,
  // because OpenGraph consumers do not render SVG.
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    siteName: TITLE,
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: TITLE }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.png"],
  },
};

/**
 * `suppressHydrationWarning` on `<html>` covers that element's own attributes
 * only, not the tree beneath it.
 *
 * The server output is `<html lang="en">` with no style attribute — verified
 * against the build — so any `style` React finds there at hydration was put on
 * by something outside React. Browser extensions do this routinely, and this is
 * a site people visit *with a wallet extension installed*, so the warning fired
 * for a large share of real visitors while pointing at nothing we control.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        <Providers>
          <main className="shell">
            <Masthead />
            {children}
            <Rule />
            <Footer />
          </main>
          <RadioStrip />
        </Providers>
      </body>
    </html>
  );
}
