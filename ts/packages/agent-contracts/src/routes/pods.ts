// Generated from pods/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import { subjectSchema, focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const podsAddress = { path: "/pods" as const, title: "Pods", fields: {
"pod": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}).default(""), "push"),
"path": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}).default(""), "push"),
"runs": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["member","pod"]}).default("member"), "replace"),
"mode": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["form","raw"]}).default("form"), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
