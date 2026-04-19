import { defineField, defineType } from "sanity";

export const siteSettings = defineType({
  name: "siteSettings",
  title: "Site Settings",
  type: "document",
  fields: [
    defineField({ name: "siteTitle", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "siteDescription", type: "text", rows: 4, validation: (rule) => rule.required() }),
    defineField({ name: "discordUrl", type: "url" }),
    defineField({ name: "twitchUrl", type: "url" }),
    defineField({ name: "youtubeUrl", type: "url" }),
    defineField({ name: "downloadUrl", type: "url" }),
    defineField({
      name: "guideVideoId",
      title: "Guide Video ID (YouTube)",
      description:
        "Paste the YouTube video ID or full URL shown on the How to Use page. Leave blank to hide the video.",
      type: "string",
    }),
  ],
});
