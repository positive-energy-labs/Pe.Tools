// Generated from families/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import type { Immutable } from "../route-kernel-data.ts";
import { focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const familiesAddress = { path: "/families" as const, title: "Families", fields: {
"readId": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "replace"),
"focus": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
