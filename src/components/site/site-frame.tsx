"use client";

import { usePathname } from "next/navigation";
import type { ComponentProps, ReactNode } from "react";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { cn } from "@/lib/utils";

type SiteFrameProps = {
  children: ReactNode;
  settings: ComponentProps<typeof SiteFooter>["settings"];
};

export function isReplayAppPath(pathname: string) {
  return (
    pathname === "/replay" ||
    pathname === "/riftreplay" ||
    pathname.startsWith("/replay/") ||
    pathname.startsWith("/riftreplay/") ||
    pathname.startsWith("/replays/tcga/")
  );
}

export function isFullScreenAppPath(pathname: string) {
  return isReplayAppPath(pathname) || pathname === "/meta-studio" || pathname.startsWith("/meta-studio/");
}

export function isViewportLockedAppPath(pathname: string) {
  return (
    isReplayAppPath(pathname) ||
    pathname === "/meta-studio" ||
    (pathname.startsWith("/meta-studio/") && pathname !== "/meta-studio/caster")
  );
}

export function SiteFrame({ children, settings }: SiteFrameProps) {
  const pathname = usePathname();
  const fullScreenApp = isFullScreenAppPath(pathname || "");
  const viewportLocked = isViewportLockedAppPath(pathname || "");

  return (
    <div
      className={cn(
        "surface-grid min-h-screen",
        fullScreenApp && "bg-[#05070b]",
        viewportLocked && "h-screen overflow-hidden",
      )}
    >
      {fullScreenApp ? null : <SiteHeader discordUrl={settings.discordUrl} downloadUrl={settings.downloadUrl} />}
      <main className={viewportLocked ? "h-screen overflow-hidden" : fullScreenApp ? "min-h-screen" : undefined}>
        {children}
      </main>
      {fullScreenApp ? null : <SiteFooter settings={settings} />}
    </div>
  );
}
