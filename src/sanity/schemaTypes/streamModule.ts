import { defineField, defineType } from "sanity";

export const streamModule = defineType({
  name: "streamModule",
  title: "Stream Module",
  type: "document",
  fields: [
    defineField({ name: "title", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "subtitle", type: "text", rows: 4, validation: (rule) => rule.required() }),
    defineField({ name: "channelLogin", type: "string", validation: (rule) => rule.required() }),
    defineField({ name: "channelUrl", type: "url", validation: (rule) => rule.required() }),
  ],
});
