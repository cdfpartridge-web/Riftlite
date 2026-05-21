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

const response = await fetch(`${baseUrl}/api/analytics/page-view/report?days=${encodeURIComponent(days)}`, {
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

console.log(`RiftLite Page View Report (${report.days} days)`);
console.log(`Generated: ${report.generatedAt}`);
console.log(`Total page views: ${report.total}`);
console.log("");

console.log("Top pages");
for (const row of report.pages.slice(0, 20)) {
  console.log(`- ${row.path}: ${row.total}${row.title ? ` (${row.title})` : ""}`);
}

console.log("");
console.log("Referrers");
for (const row of report.referrers.slice(0, 10)) {
  console.log(`- ${row.id}: ${row.total}`);
}

console.log("");
console.log("Sources");
for (const row of report.sources.slice(0, 10)) {
  console.log(`- ${row.id}: ${row.total}`);
}

console.log("");
console.log("Daily");
for (const row of report.daily) {
  console.log(`- ${row.date}: ${row.total}`);
}
