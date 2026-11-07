// Generated from family/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import { focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const familyAddress = { path: "/family" as const, title: "Family", fields: {
"stage": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"audit","type":"string","enum":["audit","apply","history"]}).default("audit"), "push"),
"pod": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string","maxLength":512}).default(""), "push"),
"path": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string","maxLength":1024}).default(""), "push"),
"pane": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"spec","type":"string","enum":["spec","output"]}).default("spec"), "replace"),
"query": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string","maxLength":4096}).default(""), "replace"),
"sort": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":{"columns":[]},"type":"object","properties":{"columns":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"dir":{"type":"string","enum":["asc","desc"]}},"required":["key","dir"]}}},"required":["columns"]}).default({"columns":[]}), "replace"),
"hidden": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":{},"type":"object","propertyNames":{"type":"string"},"additionalProperties":{"type":"boolean","const":true}}).default({}), "replace"),
"overlay": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"draft","type":"string","enum":["draft","live","saved"]}).default("draft"), "push"),
"drill": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string","maxLength":512}).default(""), "push"),
"inspector": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string","maxLength":1024,"pattern":"^((part|param):.+)?$"}).default(""), "replace"),
"doc": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"text","type":"string","enum":["text","sheet"]}).default("text"), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
