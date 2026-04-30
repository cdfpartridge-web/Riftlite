import Image from "next/image";
import Link from "next/link";

import { SITE_PATHS } from "@/lib/constants";
import type { SiteSettings } from "@/lib/types";
import { safeHref } from "@/lib/utils";

type SiteFooterProps = {
  settings: SiteSettings;
};

const footerLinks = {
  Navigate: [
    { label: "Community", href: SITE_PATHS.meta },
    { label: "Guide", href: SITE_PATHS.guide },
    { label: "News", href: SITE_PATHS.news },
    { label: "Download", href: SITE_PATHS.download },
    { label: "About", href: SITE_PATHS.about },
  ],
};

export function SiteFooter({ settings }: SiteFooterProps) {
  const social = [
    { label: "Discord", href: settings.discordUrl },
    { label: "YouTube", href: settings.youtubeUrl },
    { label: "Twitch", href: settings.twitchUrl },
  ].filter((s) => s.href);

  return (
    <footer className="relative mt-6 border-t border-white/[0.06]">
      {/* Top gradient accent */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

      <div className="bg-[rgba(6,8,16,0.72)] backdrop-blur-xl">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 lg:grid-cols-[1.4fr_1fr_1fr]">
          {/* Brand */}
          <div className="space-y-5">
            <div className="flex items-center gap-3">
              <Image
                alt="RiftLite"
                className="h-11 w-11 rounded-2xl shadow-[0_0_20px_rgba(89,167,255,0.25)]"
                height={44}
                src="/brand/riftlite-logo-ui.webp"
                width={44}
              />
              <div>
                <div className="font-display text-lg font-bold text-white">RiftLite</div>
                <div className="text-xs text-slate-500">Riftbound stats & community</div>
              </div>
            </div>
            {settings.siteDescription && (
              <p className="max-w-sm text-sm leading-6 text-slate-500">
                {settings.siteDescription}
              </p>
            )}
          </div>

          {/* Navigate */}
          <div className="space-y-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-slate-600">
              Navigate
            </div>
            <div className="space-y-2.5">
              {footerLinks.Navigate.map((link) => (
                <Link
                  className="block text-sm text-slate-400 transition-colors hover:text-white"
                  href={link.href}
                  key={link.href}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Social & Legal */}
          <div className="space-y-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.26em] text-slate-600">
              Social & Legal
            </div>
            <div className="space-y-2.5">
              {social.map((s) => (
                <Link
                  className="block text-sm text-slate-400 transition-colors hover:text-white"
                  href={safeHref(s.href)}
                  key={s.label}
                >
                  {s.label}
                </Link>
              ))}
              <Link
                className="block text-sm text-slate-400 transition-colors hover:text-white"
                href={SITE_PATHS.privacy}
              >
                Privacy
              </Link>
              <Link
                className="block text-sm text-slate-400 transition-colors hover:text-white"
                href={SITE_PATHS.cookies}
              >
                Cookies
              </Link>
            </div>
          </div>
        </div>

        <div className="border-t border-white/[0.04] px-6 py-5">
          <div className="mx-auto max-w-7xl space-y-2 text-center text-xs leading-5 text-slate-600">
            <p>© {new Date().getFullYear()} RiftLite</p>
            <p>
              All community match data is user-submitted by RiftLite players and is not
              automatically scraped from Riot services or official Riot data sources.
            </p>
            <p>
              RiftLite was created under Riot Games&apos;{" "}
              <Link
                className="text-slate-500 underline-offset-4 hover:text-slate-300 hover:underline"
                href="https://www.riotgames.com/en/legal"
                rel="noopener noreferrer"
                target="_blank"
              >
                &quot;Legal Jibber Jabber&quot;
              </Link>{" "}
              policy using assets owned by Riot Games. Riot Games does not endorse or
              sponsor this project.
            </p>
            <p>
              Riot Games and all associated properties are trademarks or registered
              trademarks of Riot Games, Inc.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
