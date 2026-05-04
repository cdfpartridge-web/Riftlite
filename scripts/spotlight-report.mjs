const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value = ""] = arg.replace(/^--/, "").split("=");
  args.set(key, value || "true");
}

const days = args.get("days") || "30";
const baseUrl = (args.get("url") || process.env.RIFTLITE_SITE_URL || "https://www.riftlite.com").replace(/\/$/, "");
const secret = args.get("secret") || process.env.COMMUNITY_AGGREGATE_SECRET;

if (!secret) {
  console.error("Missing COMMUNITY_AGGREGATE_SECRET. Pass --secret=... or set the env var.");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/spotlight/report?days=${encodeURIComponent(days)}`, {
  headers: {
    Authorization: `Bearer ${secret}`,
  },
});

if (!response.ok) {
  console.error(`Report request failed: HTTP ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

const report = await response.json();

console.log(`RiftLite Spotlight Click Report (${report.days} days)`);
console.log(`Generated: ${report.generatedAt}`);
console.log(`Total clicks: ${report.total}`);
console.log("");

console.log("Spotlights");
for (const row of report.spotlights) {
  console.log(`- ${row.id}: ${row.total}`);
  for (const link of row.links.slice(0, 8)) {
    console.log(`  - ${link.id}: ${link.total}`);
  }
}

console.log("");
console.log("Top links");
for (const row of report.links.slice(0, 10)) {
  console.log(`- ${row.id}: ${row.total}`);
}

console.log("");
console.log("Daily");
for (const row of report.daily) {
  console.log(`- ${row.date}: ${row.total}`);
}
