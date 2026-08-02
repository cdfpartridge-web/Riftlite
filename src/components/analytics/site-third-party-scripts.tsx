"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";

import { PageViewTracker } from "@/components/analytics/page-view-tracker";

export function SiteThirdPartyScripts() {
  const pathname = usePathname() || "";
  if (
    pathname === "/link-device" ||
    pathname.startsWith("/link-device/") ||
    pathname === "/meta-studio" ||
    pathname.startsWith("/meta-studio/")
  ) {
    return null;
  }

  return (
    <>
      <PageViewTracker />
      <Script
        async
        src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1277251394011398"
        crossOrigin="anonymous"
        strategy="afterInteractive"
      />
    </>
  );
}
