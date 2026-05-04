const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value = ""] = arg.replace(/^--/, "").split("=");
  args.set(key, value || "true");
}

const baseUrl = (args.get("url") || process.env.RIFTLITE_SITE_URL || "https://www.riftlite.com").replace(/\/$/, "");
const secret = args.get("secret") || process.env.COMMUNITY_AGGREGATE_SECRET;
const format = args.get("format") || "summary";

if (!secret) {
  console.error("Missing COMMUNITY_AGGREGATE_SECRET. Pass --secret=... or set the env var.");
  process.exit(1);
}

const response = await fetch(`${baseUrl}/api/account/marketing`, {
  headers: {
    Authorization: `Bearer ${secret}`,
  },
});

if (!response.ok) {
  console.error(`Marketing report request failed: HTTP ${response.status}`);
  console.error(await response.text());
  process.exit(1);
}

const report = await response.json();
const rows = Array.isArray(report.subscribers) ? report.subscribers : [];

if (format === "csv") {
  console.log(["email", "displayName", "handle", "uid", "consentAt", "consentUpdatedAt", "consentVersion", "consentSource"].join(","));
  for (const row of rows) {
    console.log([
      csv(row.email),
      csv(row.displayName),
      csv(row.handle),
      csv(row.uid),
      csv(row.consentAt),
      csv(row.consentUpdatedAt),
      csv(row.consentVersion),
      csv(row.consentSource),
    ].join(","));
  }
} else {
  console.log(`RiftLite Marketing Consent Report`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Consented emails: ${report.count}`);
  console.log("");
  for (const row of rows.slice(0, 50)) {
    const name = row.displayName || row.handle || row.uid;
    const date = row.consentAt ? new Date(row.consentAt).toISOString() : "unknown date";
    console.log(`- ${row.email} (${name}) - ${date}`);
  }
  if (rows.length > 50) {
    console.log(`...and ${rows.length - 50} more. Use --format=csv for the full export.`);
  }
}

function csv(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}
