import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";
import Script from "next/script";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { getSiteSettings } from "@/lib/sanity/content";

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
    default: "RiftLite",
    template: "%s | RiftLite",
  },
  description:
    "Live Riftbound stats, decks, and matchup data — powered by the community. Browse win rates, study the meta, and find what's winning right now.",
  metadataBase: new URL("https://www.riftlite.com"),
  openGraph: {
    title: "RiftLite",
    description:
      "Live Riftbound stats, decks, and matchup data — built for players, by the community.",
    type: "website",
    images: ["/brand/riftlite-logo-transparent.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "RiftLite",
    description:
      "Live Riftbound stats, decks, and matchup data — built for players, by the community.",
    images: ["/brand/riftlite-logo-transparent.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettings();

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "RiftLite",
      url: "https://www.riftlite.com",
      logo: "https://www.riftlite.com/brand/riftlite-logo-transparent.png",
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "RiftLite",
      url: "https://www.riftlite.com",
      potentialAction: {
        "@type": "SearchAction",
        target: "https://www.riftlite.com/community/decks?q={search_term_string}",
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "RiftLite",
      applicationCategory: "GameApplication",
      operatingSystem: "Windows",
      url: "https://www.riftlite.com/download",
      description:
        "Desktop companion app for Riftbound. Fully automatic match tracking on TCGA and RiftAtlas, visual replays, streamer overlay for OBS, personal matchup matrix, and community meta.",
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
