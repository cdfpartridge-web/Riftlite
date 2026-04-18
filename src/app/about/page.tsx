import { SectionHeading } from "@/components/site/section-heading";
import { Card } from "@/components/ui/card";

const pillars = [
  {
    title: "Structured match data",
    body: "RiftLite captures game results, legend matchups, deck compositions, and battlefield data — all synced to a shared community feed automatically.",
  },
  {
    title: "Read-only public surface",
    body: "The public website exposes that data as a clean, sponsor-ready analytics layer — leaderboards, meta tables, matchup matrices, and deck snapshots.",
  },
  {
    title: "No spreadsheets required",
    body: "Every number on this site is derived from the same logic the desktop app uses, so community discussions start from a shared source of truth.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
      <SectionHeading
        eyebrow="About"
        title="RiftLite turns scattered match logs into a coherent community picture."
        description="The app captures and syncs structured match data, while the public site turns it into a clean, readable, sponsor-ready analytics surface."
      />

      <div className="grid gap-5 md:grid-cols-3">
        {pillars.map((pillar) => (
          <Card className="space-y-3" key={pillar.title}>
            <h3 className="font-display text-base font-semibold text-white">
              {pillar.title}
            </h3>
            <p className="text-sm leading-6 text-slate-400">{pillar.body}</p>
          </Card>
        ))}
      </div>

      <Card className="space-y-4">
        <h3 className="font-display text-lg font-semibold text-white">The full picture</h3>
        <p className="text-base leading-7 text-slate-400">
          RiftLite is built to help Riftbound players understand matchups, decks, and performance
          trends without relying on screenshots or spreadsheets. The desktop app stays the source of
          truth; this site gives that data a public home.
        </p>
        <p className="text-base leading-7 text-slate-400">
          Every stat on this site is a read-only window into the community feed — live, filterable,
          and always in sync with the same snapshot logic the app uses.
        </p>
      </Card>
    </div>
  );
}
