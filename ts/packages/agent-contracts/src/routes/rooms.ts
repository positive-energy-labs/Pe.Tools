// Generated from rooms/route.ts by codegen:routes. Do not edit.
import { z } from "zod";
import type { Immutable } from "../route-kernel-data.ts";
import { focusSelectionSchema } from "../route-kernel-codecs.ts";
import { jsonCodec } from "../route-field.ts";
const field = <S extends z.ZodType>(schema:S,url:"push"|"replace") => ({ schema, url, agent:"set" as const, codec: jsonCodec(schema) });
export const roomsAddress = { path: "/rooms" as const, title: "Rooms", fields: {
"stage": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"partition","type":"string","enum":["partition","review","history"]}) as z.ZodType<Immutable<"partition" | "review" | "history">>).default("partition"), "push"),
"view": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"","type":"string"}) as z.ZodType<Immutable<string>>).default(""), "push"),
"layers": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":[],"anyOf":[{"type":"array","items":{"type":"string"}},{"type":"string","const":"all"}]}) as z.ZodType<Immutable<Array<string> | "all">>).default([]), "replace"),
"show": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":"all","type":"string","enum":["all","proposed","fail","stale","gone","accepted","pass","note"]}) as z.ZodType<Immutable<"all" | "proposed" | "fail" | "stale" | "gone" | "accepted" | "pass" | "note">>).default("all"), "replace"),
"viewport": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":null,"anyOf":[{"type":"object","properties":{"kind":{"type":"string","const":"plane"},"scale":{"type":"number"},"tx":{"type":"number"},"ty":{"type":"number"}},"required":["kind","scale","tx","ty"]},{"type":"null"}]}) as z.ZodType<Immutable<{"kind": "plane"; "scale": number; "tx": number; "ty": number} | null>>).default(null), "replace"),
"picked": field((z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","default":[],"anyOf":[{"type":"array","items":{"type":"string"}},{"type":"string","const":"all"}]}) as z.ZodType<Immutable<Array<string> | "all">>).default([]), "replace"),
selected: {...field(focusSelectionSchema,"replace"),agent:undefined}
}, agent: { policy: "Use the route fields as declared." } };
