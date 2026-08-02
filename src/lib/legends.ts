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

const RIFTBOUND_LEGEND_CARD_IMAGES: Record<string, string> = {
  ...LEGEND_IMAGE_OVERRIDES,
  "Ahri": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-255/full-desktop-2x.avif",
  "Annie": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGS/cards/OGS-017/full-desktop-2x.avif",
  "Azir": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/42c04e4d7ef5d7395494587c2e15ac945b37b71e-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Darius": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-253/full-desktop-2x.avif",
  "Diana": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8bd4006c34aa020211e501e3cb7ee14ab5b4c41f-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Draven": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5a06fcd2cadbdb574d34d210ca97441ec33c9277-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Ezreal": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/3ba4f1d3d61d80e7becc9d046e1974f17bff4b10-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Fiora": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/720df5a56619a6b53aa1217cb84446f2469b40e5-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Irelia": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/8258072391bbb8d24e9d6e603c3ba1434979a911-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Ivern": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d200178cde5075990f7ca1856675d02c4c2538be-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Jax": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/941f72a422e0143524b3dd0cba1fd87e4286ecb4-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Jhin": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/47f10693258104e9373396165e335014bf5783a2-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Jinx": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-251/full-desktop-2x.avif",
  "Kai'Sa": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-247/full-desktop-2x.avif",
  "Kha'Zix": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/ffed0102adcae6fe01d173042487ea85ebe899bc-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "LeBlanc": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/656450f89be4dc253438a4e0af7f7638ed5f90b2-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=744",
  "Lee Sin": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-257/full-desktop-2x.avif",
  "Leona": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-261/full-desktop-2x.avif",
  "Lillia": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5099aa2938091dfcc54277877e320a7f83aeeec1-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=744",
  "Lucian": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/eb2a5262da6044c041ba87becae1dc71d58b2bf7-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Lux": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGS/cards/OGS-021/full-desktop-2x.avif",
  "Miss Fortune": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-267/full-desktop-2x.avif",
  "Ornn": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/883dab66da8ed5ab39d968ed7fcaebd5ebaf3d43-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Poppy": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/41321ddb3b1c63492285d1c3d067ee42ade502e4-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Pyke": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/b4095d98aff998fda5a08d4c32e97a2a66ccf1e6-744x1039.png?accountingTag=RB&auto=format&fit=fill&q=80&w=744",
  "Rek'Sai": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/968eb5c484a25bbebd162f31736024b4ff3b0d07-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Renata Glasc": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/5df25d5a1351d0a97e103ef8e155991297b86ca9-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Rengar": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/1f80a016015ebc77bd3d23ce471e364d70698279-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Rumble": riftAtlasLegendImageUrl("SFD-181"),
  "Sett": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-269/full-desktop-2x.avif",
  "Sivir": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/743887bce0027f549b85bf023475c3587a005581-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Teemo": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-263/full-desktop-2x.avif",
  "Vex": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/d044ea46fa38cff80c39fdb0b890dd7226c22b89-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Vi": "https://cmsassets.rgpub.io/sanity/images/dsfx7636/game_data_live/08c48ad82381bb5830a0b413d7a2f25dd2b20d76-744x1039.png?auto=format&fit=fill&q=80&w=744",
  "Viktor": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-265/full-desktop-2x.avif",
  "Volibear": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-249/full-desktop-2x.avif",
  "Yasuo": "https://cdn.rgpub.io/public/live/map/riftbound/latest/OGN/cards/OGN-259/full-desktop-2x.avif",
};

const DDV = "16.13.1";

export function getLegendImageUrl(legend: string): string {
  const override = LEGEND_IMAGE_OVERRIDES[legend];
  if (override) return override;
  const id = CHAMPION_ID_MAP[legend] ?? legend.replace(/[^a-zA-Z]/g, "");
  return `https://ddragon.leagueoflegends.com/cdn/${DDV}/img/champion/${id}.png`;
}

export function getLegendCardImageUrl(legend: string): string {
  const direct = RIFTBOUND_LEGEND_CARD_IMAGES[legend];
  if (direct) return direct;
  const baseLegend = legend.split(",")[0]?.trim() ?? "";
  return RIFTBOUND_LEGEND_CARD_IMAGES[baseLegend] ?? getLegendImageUrl(legend);
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
