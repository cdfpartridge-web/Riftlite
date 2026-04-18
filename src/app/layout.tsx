import type { Metadata } from "next";
import { Manrope, Space_Grotesk } from "next/font/google";

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
    "Read-only community analytics, matchup matrices, deck snapshots, stream embeds, and news for RiftLite.",
  metadataBase: new URL("https://riftlite.vercel.app"),
  openGraph: {
    title: "RiftLite",
    description:
      "The official public home for RiftLite community stats, decks, stream coverage, and updates.",
    type: "website",
    images: ["/brand/riftlite-logo-transparent.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "RiftLite",
    description:
      "The official public home for RiftLite community stats, decks, stream coverage, and updates.",
    images: ["/brand/riftlite-logo-transparent.png"],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const settings = await getSiteSettings();

  return (
    <html data-scroll-behavior="smooth" lang="en" suppressHydrationWarning>
      <body
        className={`${bodyFont.variable} ${displayFont.variable} font-sans antialiased`}
      >
        <div className="surface-grid min-h-screen">
          <SiteHeader downloadUrl={settings.downloadUrl} />
          <main>{children}</main>
          <SiteFooter settings={settings} />
        </div>
      </body>
    </html>
  );
}
