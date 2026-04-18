import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { visionTool } from "@sanity/vision";

import { schemaTypes } from "./src/sanity/schemaTypes";

const singletons = ["siteSettings", "homeHero", "streamModule"];

export default defineConfig({
  name: "default",
  title: "RiftLite Studio",
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ?? "demo",
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET ?? "production",
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title("Content")
          .items([
            S.listItem().title("Site Settings").id("siteSettings").child(
              S.document().schemaType("siteSettings").documentId("siteSettings"),
            ),
            S.listItem().title("Home Hero").id("homeHero").child(
              S.document().schemaType("homeHero").documentId("homeHero"),
            ),
            S.listItem().title("Stream Module").id("streamModule").child(
              S.document().schemaType("streamModule").documentId("streamModule"),
            ),
            S.divider(),
            ...S.documentTypeListItems().filter(
              (item) => !singletons.includes(item.getId() ?? ""),
            ),
          ]),
    }),
    visionTool(),
  ],
  schema: {
    types: schemaTypes,
  },
});
