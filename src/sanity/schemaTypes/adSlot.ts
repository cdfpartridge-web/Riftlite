import { defineField, defineType } from "sanity";

export const adSlot = defineType({
  name: "adSlot",
  title: "Ad Slot",
  type: "document",
  fields: [
    defineField({
      name: "placement",
      type: "string",
      options: {
        list: ["home-hero", "home-mid", "community-sidebar", "news-inline", "news-footer"],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: "mode",
      type: "string",
      options: {
        list: ["sponsor", "adsense", "placeholder"],
      },
      validation: (rule) => rule.required(),
    }),
    defineField({ name: "title", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "eyebrow", type: "string" }),
    defineField({ name: "body", type: "text", rows: 4 }),
    defineField({ name: "ctaLabel", type: "string" }),
    defineField({ name: "ctaHref", type: "string" }),
    defineField({ name: "imageUrl", type: "url" }),
    defineField({ name: "adsenseClient", type: "string" }),
    defineField({ name: "adsenseSlot", type: "string" }),
  ],
});
