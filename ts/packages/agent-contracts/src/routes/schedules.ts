// Generated from schedules/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import type { Immutable } from "../route-kernel-data.ts";
import { subjectSchema, focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const schedulesAddress = { path: "/schedules" as const, title: "Schedules", fields: {
"workspaceId": field(subjectSchema(1).default({"kind":"ids","ids":[]}), "push"),
"table": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string"},"sorts":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"dir":{"type":"string","enum":["asc","desc"]}},"required":["key","dir"]}},"hiddenColumns":{"type":"array","items":{"type":"string"}}},"required":["query","sorts","hiddenColumns"]}) as z.ZodType<Immutable<{"query": string; "sorts": Array<{"key": string; "dir": "asc" | "desc"}>; "hiddenColumns": Array<string>}>>).default({"query":"","sorts":[],"hiddenColumns":[]}), "replace"),
"cell": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","pattern":"^(\\d+::\\d+)?$"}) as z.ZodType<Immutable<string>>).default(""), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Choose schedule through workspaceId, using the module's local identities." } };
