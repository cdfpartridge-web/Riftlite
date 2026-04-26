import { createClient } from "@sanity/client";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load .env.local without extra deps
const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, "..", ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }),
);

// GitHub's "latest release" redirect. Always 302s to the most recent
// release's asset with this exact filename, so we never have to bump
// the download link when a new version ships — just upload the asset
// as `RiftLiteBetaInstall.exe` on the GitHub release and we're done.
//   https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases
const DOWNLOAD_URL =
  "https://github.com/cdfpartridge-web/RiftLite-Desktop/releases/latest/download/RiftLiteBetaInstall.exe";

const client = createClient({
  projectId: env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-10-01",
  token: env.SANITY_API_TOKEN,
  useCdn: false,
});

const docs = await client.fetch(
  `*[_type == "siteSettings"]{_id, downloadUrl}`,
);

if (docs.length === 0) {
  console.log("No siteSettings docs found.");
  process.exit(0);
}

for (const doc of docs) {
  console.log(`Patching ${doc._id}: ${doc.downloadUrl} -> ${DOWNLOAD_URL}`);
  await client.patch(doc._id).set({ downloadUrl: DOWNLOAD_URL }).commit();
}

console.log(`Done. Patched ${docs.length} doc(s).`);
