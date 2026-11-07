// Generated from fans/route.ts by codegen:routes. Do not edit.
import { fansDocumentSchema as schema } from "../fans.ts";
import { salvageWork } from "../route-state.ts";
export const fansRouteState = { route: "fans", title: "Fans", description: schema.description ?? "Inspect fan paths, inputs and pressure requirements", schema, schemaVersion: 1, salvage: (raw:unknown)=>salvageWork(schema,raw).doc };
