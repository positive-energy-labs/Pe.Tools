// Generated from duct-loss/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import { focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const ductLossAddress = { path: "/duct-loss" as const, title: "Duct Loss", fields: {
"shape": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["round","rect"]}).default("round"), "push"),
"a": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number"}).default(12), "replace"),
"b": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number"}).default(8), "replace"),
"cfm": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number"}).default(1000), "replace"),
"length": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number"}).default(100), "replace"),
"roughness": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number"}).default(0.0003), "replace"),
"density": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"number"}).default(0.075), "replace"),
"face": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["commercial","residential"]}).default("commercial"), "push"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
