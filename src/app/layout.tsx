import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import Script from "next/script";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getSiteSettings } from "@/lib/sanity/content";
import {
  absoluteUrl,
  DEFAULT_OG_IMAGE,
  DEFAULT_SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "@/lib/seo";
import { safeHref } from "@/lib/utils";

import "./globals.css";

const bodyFont = Manrope({
  subsets: ["latin"],
  variable: "--font-rift-body",
});

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-rift-display",
});

export const metadata: Metadata = {
  title: {
    default: "RiftLite - Automatic Riftbound Match Tracking",
    template: "%s | RiftLite",
  },
  description: DEFAULT_SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    title: "RiftLite - Automatic Riftbound Match Tracking",
    description: DEFAULT_SITE_DESCRIPTION,
    siteName: SITE_NAME,
    type: "website",
    url: SITE_URL,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "RiftLite - Automatic Riftbound Match Tracking",
    description: DEFAULT_SITE_DESCRIPTION,
    images: [DEFAULT_OG_IMAGE],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettings();
  const sameAs = [settings.discordUrl, settings.youtubeUrl, settings.twitchUrl]
    .filter((href): href is string => Boolean(href))
    .map((href) => safeHref(href))
    .filter((href) => href.startsWith("http"));
  const downloadUrl = absoluteUrl(safeHref(settings.downloadUrl));

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: absoluteUrl(DEFAULT_OG_IMAGE),
      sameAs,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      name: SITE_NAME,
      url: SITE_URL,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: SITE_NAME,
      applicationCategory: "GameApplication",
      operatingSystem: "Windows",
      url: absoluteUrl("/download"),
      downloadUrl,
      image: absoluteUrl("/screenshots/replay-viewer.webp"),
      screenshot: absoluteUrl("/screenshots/replay-viewer.webp"),
      description: DEFAULT_SITE_DESCRIPTION,
      featureList: [
        "Automatic Riftbound match tracking on TCGA and RiftAtlas",
        "Turn-by-turn visual replay viewer",
        "Personal matchup matrix and win-rate history",
        "Community meta and matchup data",
        "OBS streamer overlay",
      ],
      isAccessibleForFree: true,
      publisher: { "@id": `${SITE_URL}/#organization` },
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ];

  return (
    <html data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
      <body
        className={`${bodyFont.variable} ${displayFont.variable} font-sans antialiased`}
      >
        <Script
          id="jsonld-site"
          type="application/ld+json"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <div className="surface-grid min-h-screen">
          <SiteHeader discordUrl={settings.discordUrl} downloadUrl={settings.downloadUrl} />
          <main>{children}</main>
          <SiteFooter settings={settings} />
        </div>
        <Script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1277251394011398"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
