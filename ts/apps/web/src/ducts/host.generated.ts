// Generated from route.ts by codegen:routes. Do not edit.
import { ductsRouteState as work } from "../../../../packages/agent-contracts/src/generated/ducts-work.ts";
import {z} from "zod";
import {RouteGraphJson} from "../../../../packages/agent-contracts/src/route-kernel-data.ts";
import type {HostRouteModule} from "@pe/agent-contracts";
import closure from "./source-closure.generated.json" with {type:"json"};
const data=RouteGraphJson.parse(closure.envelope.data);
export const host:HostRouteModule={data,bodies:{},workState:work,readWorks:["fans"],schemas:{[data.work!.schema!]:work.schema,[data.historyDetail!]:z.fromJSONSchema({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"rowKey":{"anyOf":[{"type":"string"},{"type":"null"}]},"clear":{"type":"boolean"},"was":{"type":"string"},"row":{"type":"object","properties":{"label":{"type":"string"},"section":{"type":"string","enum":["units","terminals","parts","rulings"]},"ids":{"type":"array","items":{"type":"number"}}},"required":["label","section","ids"]}},"additionalProperties":false})},};
