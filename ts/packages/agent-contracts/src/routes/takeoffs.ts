// Generated from takeoffs/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import type { Immutable } from "../route-kernel-data.ts";
import { focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const takeoffsAddress = { path: "/takeoffs" as const, title: "View adoption", fields: {
"level": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "push"),
"zone": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "push"),
"room": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "push"),
"viewport": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":null,"anyOf":[{"type":"object","properties":{"kind":{"type":"string","const":"plane"},"scale":{"type":"number"},"tx":{"type":"number"},"ty":{"type":"number"}},"required":["kind","scale","tx","ty"]},{"type":"null"}]}) as z.ZodType<Immutable<{"kind": "plane"; "scale": number; "tx": number; "ty": number} | null>>).default(null), "replace"),
"threadSearch": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":{"v":1,"keywords":"","pills":[{"field":"scope","op":"=","value":"all"}]},"description":"JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal keywords and equality pills. Fields: target, provider, state, unread, scope. Scope values: attention, all, archived.","type":"object","properties":{"v":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},"keywords":{"type":"string","maxLength":4000},"pills":{"maxItems":32,"type":"array","items":{"type":"object","properties":{"field":{"type":"string"},"op":{"type":"string"},"value":{"type":"string"}},"required":["field","op","value"]}}},"required":["v","keywords","pills"]}) as z.ZodType<Immutable<{"v": number; "keywords": string; "pills": Array<{"field": string; "op": string; "value": string}>}>>).default({"v":1,"keywords":"","pills":[{"field":"scope","op":"=","value":"all"}]}), "replace"),
"threadSort": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string","enum":["","recent","title"]}) as z.ZodType<Immutable<"" | "recent" | "title">>).default(""), "replace"),
"views": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","anyOf":[{"type":"array","items":{"type":"string"}},{"type":"string","const":"all"}]}) as z.ZodType<Immutable<Array<string> | "all">>).default([]), "push"),
"zones": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","anyOf":[{"type":"array","items":{"type":"string"}},{"type":"string","const":"all"}]}) as z.ZodType<Immutable<Array<string> | "all">>).default([]), "push"),
"work": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "push"),
"r10": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "push"),
"stage": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","const":"adopt"}) as z.ZodType<Immutable<"adopt">>).default("adopt"), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
