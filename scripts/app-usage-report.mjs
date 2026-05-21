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

const response = await fetch(`${baseUrl}/api/desktop/report?days=${encodeURIComponent(days)}`, {
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

console.log(`RiftLite App Usage Report (${report.days} days)`);
console.log(`Generated: ${report.generatedAt}`);
console.log(`Daily active install-days: ${report.totals.dailyActiveInstalls}`);
console.log(`New installs: ${report.totals.newInstalls}`);
console.log(`Heartbeats: ${report.totals.heartbeats}`);
console.log("");

console.log("Daily");
for (const row of report.daily) {
  console.log(`- ${row.date}: ${row.dailyActiveInstalls} active, ${row.newInstalls} new, ${row.heartbeats} heartbeat${row.heartbeats === 1 ? "" : "s"}`);
}

console.log("");
console.log("Versions");
for (const row of report.appVersions.slice(0, 12)) {
  console.log(`- ${row.id}: ${row.total}`);
}

console.log("");
console.log("Platforms");
for (const row of report.platforms) {
  console.log(`- ${row.id}: ${row.total}`);
}

console.log("");
console.log("Features");
for (const row of report.features) {
  console.log(`- ${row.id}: ${row.total}`);
}

console.log("");
console.log("Capture platforms");
for (const row of report.activePlatforms) {
  console.log(`- ${row.id}: ${row.total}`);
}
