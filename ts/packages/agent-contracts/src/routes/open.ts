// Generated from open/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import { focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const openAddress = { path: "/open" as const, title: "Open document", fields: {
"draft": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"doc":{"anyOf":[{"type":"string"},{"type":"null"}]},"target":{"anyOf":[{"type":"string"},{"type":"null"}]},"year":{"anyOf":[{"type":"integer","minimum":-9007199254740991,"maximum":9007199254740991},{"type":"null"}]},"owner":{"type":"string","enum":["you","pea"]},"addins":{"type":"string","enum":["on","off"]},"detach":{"type":"boolean"},"links":{"type":"string","enum":["refuse","allow"]}},"required":["doc","target","year","owner","addins","detach","links"]}).default({"doc":null,"target":null,"year":null,"owner":"you","addins":"on","detach":false,"links":"refuse"}), "replace"),
"table": field(z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"query":{"type":"string"},"sorts":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"dir":{"type":"string","enum":["asc","desc"]}},"required":["key","dir"]}},"hiddenColumns":{"type":"array","items":{"type":"string"}}},"required":["query","sorts"]}).default({"query":"","sorts":[]}), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
