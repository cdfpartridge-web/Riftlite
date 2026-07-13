const CHAMPION_ID_MAP: Record<string, string> = {
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Lee Sin": "LeeSin",
  "LeBlanc": "Leblanc",
  "Miss Fortune": "MissFortune",
  "Rek'Sai": "RekSai",
  "Renata Glasc": "Renata",
};

const RIFTATLAS_LEGEND_CARD_CODES: Record<string, string> = {
  "Akali": "VEN-139",
  "Renekton": "VEN-141",
  "Zed": "VEN-143",
  "Nasus": "VEN-145",
  "Shen": "VEN-147",
  "Jayce": "VEN-149",
  "Mel": "VEN-151",
  "Ambessa": "VEN-153",
  "Kennen": "VEN-155",
};

function riftAtlasLegendImageUrl(cardCode: string): string {
  return `https://assets.riftatlas-workers.com/cdn-cgi/image/width=192,quality=85,format=auto,fit=scale-down/riftbound/cards/small-v2/${cardCode}.webp`;
}

const LEGEND_IMAGE_OVERRIDES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(RIFTATLAS_LEGEND_CARD_CODES).map(([legend, cardCode]) => [
    legend,
    riftAtlasLegendImageUrl(cardCode),
  ])),
  "Garen": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGS/cards/OGS-023/full-desktop-2x.avif",
  "Master Yi": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/557e41d84ac36ffa2bf805deda159f45e0a815f9-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Master Yi, Wuju Bladesman": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGS/cards/OGS-019/full-desktop-2x.avif",
  "Master Yi, Wuju Master": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/557e41d84ac36ffa2bf805deda159f45e0a815f9-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Master Yi, Wuji Master": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/557e41d84ac36ffa2bf805deda159f45e0a815f9-744x1039.png?auto=format&fit=fill&q=80&w=744",
};

const DDV = "16.13.1";

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
