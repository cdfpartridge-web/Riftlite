const CHAMPION_ID_MAP: Record<string, string> = {
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  "Lee Sin": "LeeSin",
  "LeBlanc": "Leblanc",
  "Miss Fortune": "MissFortune",
  "Master Yi (Wuju Bladesman)": "MasterYi",
  "Master Yi (Wuju Master)": "MasterYi",
  "Rek'Sai": "RekSai",
  "Renata Glasc": "Renata",
};

const DDV = "14.24.1";

export function getLegendImageUrl(legend: string): string {
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
