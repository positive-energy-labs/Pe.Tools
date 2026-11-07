// Generated from home/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import { focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const homeAddress = { path: "/" as const, title: "Home", fields: {
"threadSearch": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":{"v":1,"keywords":"","pills":[{"field":"scope","op":"=","value":"all"}]},"description":"JSON {v:1,keywords:string,pills:[{field,op:'=',value}]}. Literal keywords and equality pills. Fields: target, provider, state, unread, scope. Scope values: attention, all, archived.","type":"object","properties":{"v":{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},"keywords":{"type":"string","maxLength":4000},"pills":{"maxItems":32,"type":"array","items":{"type":"object","properties":{"field":{"type":"string"},"op":{"type":"string"},"value":{"type":"string"}},"required":["field","op","value"]}}},"required":["v","keywords","pills"]}).default({"v":1,"keywords":"","pills":[{"field":"scope","op":"=","value":"all"}]}), "replace"),
"threadSort": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string","enum":["","recent","title"]}).default(""), "replace"),
"query": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string"}).default(""), "replace"),
"exposure": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["All","Main","Preview","Archive"]}).default("All"), "push"),
"sort": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","enum":["workflow","name"]}).default("workflow"), "push"),
"folded": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"array","items":{"type":"string"}}).default([]), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
