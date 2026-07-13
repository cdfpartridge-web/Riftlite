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

function isReplayAppPath(pathname: string) {
  return (
    pathname === "/replay" ||
    pathname === "/riftreplay" ||
    pathname.startsWith("/replay/") ||
    pathname.startsWith("/riftreplay/")
  );
}

export function SiteFrame({ children, settings }: SiteFrameProps) {
  const pathname = usePathname();
  const replayApp = isReplayAppPath(pathname || "");

  return (
    <div className={cn("surface-grid min-h-screen", replayApp && "h-screen overflow-hidden bg-[#05070b]")}>
      {replayApp ? null : <SiteHeader discordUrl={settings.discordUrl} downloadUrl={settings.downloadUrl} />}
      <main className={replayApp ? "h-screen overflow-hidden" : undefined}>{children}</main>
      {replayApp ? null : <SiteFooter settings={settings} />}
    </div>
  );
}
