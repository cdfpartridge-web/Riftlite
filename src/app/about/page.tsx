import { SectionHeading } from "@/components/site/section-heading";
import { Card } from "@/components/ui/card";

const pillars = [
  {
    title: "Real matches, logged fast",
    body: "The app auto-fills legends, decks, and matchup details — you just confirm the result. From there your games feed straight into the community stats.",
  },
  {
    title: "Stats you can actually trust",
    body: "Win rates, matchups, and deck performance all come from real games played by real players. Browse the numbers anytime, on any device.",
  },
  {
    title: "Built for the Riftbound community",
    body: "Every player who tracks their games makes the data better for everyone. The more matches we share, the sharper the meta picture gets.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
      <SectionHeading
        eyebrow="About"
        title="The home for Riftbound stats, decks, and meta insights."
        description="RiftLite turns the games you play into community-wide insights — so every player can study real matchups instead of guessing."
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
          Whether you're chasing the top of the leaderboard or just trying to figure out what beats
          the deck you keep losing to, RiftLite gives you the data to make smarter decisions.
        </p>
        <p className="text-base leading-7 text-slate-400">
          Filter by legend, dig into matchups, study the decks topping the meta — all updated live
          as the community plays. No login required to browse.
        </p>
      </Card>
    </div>
  );
}
