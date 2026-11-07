// Generated from settings/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import { subjectSchema, focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const settingsAddress = { path: "/settings" as const, title: "Settings", fields: {
"section": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["none","revit","update","share","pea","host","notices","appearance"]}).default(undefined), "push"),
"session": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}).default(""), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
