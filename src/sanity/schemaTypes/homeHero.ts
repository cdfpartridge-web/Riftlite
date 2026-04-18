import { defineField, defineType } from "sanity";

export const homeHero = defineType({
  name: "homeHero",
  title: "Home Hero",
  type: "document",
  fields: [
    defineField({ name: "eyebrow", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "headline", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "subheading", type: "text", rows: 4, validation: (rule) => rule.required() }),
    defineField({ name: "primaryCtaLabel", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "primaryCtaHref", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "secondaryCtaLabel", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "secondaryCtaHref", type: "string", validation: (rule) => rule.required() }),
  ],
});
