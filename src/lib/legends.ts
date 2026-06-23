const CHAMPION_ID_MAP: Record<string, string> = {
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Lee Sin": "LeeSin",
  "LeBlanc": "Leblanc",
  "Miss Fortune": "MissFortune",
  "Rek'Sai": "RekSai",
  "Renata Glasc": "Renata",
};

const LEGEND_IMAGE_OVERRIDES: Record<string, string> = {
  "Master Yi, Wuju Bladesman": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGS/cards/OGS-019/full-desktop-2x.avif",
  "Master Yi, Wuju Master": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/557e41d84ac36ffa2bf805deda159f45e0a815f9-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Master Yi, Wuji Master": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/557e41d84ac36ffa2bf805deda159f45e0a815f9-744x1039.png?auto=format&fit=fill&q=80&w=744",
};

const DDV = "14.24.1";

export function getLegendImageUrl(legend: string): string {
  const override = LEGEND_IMAGE_OVERRIDES[legend];
  if (override) return override;
  const id = CHAMPION_ID_MAP[legend] ?? legend.replace(/[^a-zA-Z]/g, "");
  return `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/champion/${id}.png`;
}

export function getLegendInitials(legend: string): string {
  return legend
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
