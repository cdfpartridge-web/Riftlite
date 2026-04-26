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

// New guide walkthrough — https://youtu.be/h55CT7A5Cm0
const GUIDE_VIDEO_ID = "h55CT7A5Cm0";

const client = createClient({
  projectId: env.NEXT_PUBLIC_SANITY_PROJECT_ID,
  dataset: env.NEXT_PUBLIC_SANITY_DATASET,
  apiVersion: "2024-10-01",
  token: env.SANITY_API_TOKEN,
  useCdn: false,
});

const docs = await client.fetch(
  `*[_type == "siteSettings"]{_id, guideVideoId}`,
);

if (docs.length === 0) {
  console.log("No siteSettings docs found.");
  process.exit(0);
}

for (const doc of docs) {
  console.log(`Patching ${doc._id}: ${doc.guideVideoId} -> ${GUIDE_VIDEO_ID}`);
  await client.patch(doc._id).set({ guideVideoId: GUIDE_VIDEO_ID }).commit();
}

console.log(`Done. Patched ${docs.length} doc(s).`);
