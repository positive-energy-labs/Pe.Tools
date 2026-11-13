import { z } from "zod";
import { createJiti } from "jiti";
import type { HostRouteModule, RouteGraphWire } from "@pe/agent-contracts";
import { builtinData } from "../../../packages/agent-contracts/src/route-kernel.fixtures.ts";

/** Exercise the same discovery projection as a newly authored Pod. */
export async function podWire(key: string, address: string, version = 1, name = "Registry", initial = false) {
  // Load the browser authoring generator through its own TS/JSX loader, as codegen does.
  const { route, field, scrollBody } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" } }).import<{
    route(spec: object): { data: RouteGraphWire; host: HostRouteModule };
    field(schema: z.ZodType, initial: string, role: string): unknown;
    scrollBody(value: null): unknown;
  }>(new URL("../../web/src/route/typed-route.ts", import.meta.url).href);
  const work = z.object({
    amount: initial ? z.number().default(0) : z.number(),
    note: initial ? z.string().default("") : z.string(),
  });
  return route({
    key, address, name, needs: "browser", directory: builtinData.directory,
    fields: { system: field(z.string(), "", "query"), viewport: field(z.string(), "", "pose") },
    edits: {
      work: { route: key, title: name, description: "Host admission probe", schema: work, schemaVersion: version },
      owners: {}, input: work, patches: () => [], history: z.object({ label: z.string() }), describe: () => ({ label: "Edit" }),
    },
    panes: { main: { title: "Main", purpose: "Inspect", body: "scroll", draw: () => scrollBody(null) } },
    layout: { kind: "pane", id: "main" },
  });
}

export function podHostSource(module: Awaited<ReturnType<typeof podWire>>, zod: string) {
  return `import {z} from ${JSON.stringify(zod)};
const data=${JSON.stringify(module.data)};
const schemas=Object.fromEntries(Object.entries(${JSON.stringify(Object.fromEntries(
    Object.entries(module.host.schemas).map(([key, schema]) => [key, z.toJSONSchema(schema, { io: "input" })]),
  ))}).map(([key,schema])=>[key,z.fromJSONSchema(schema)]));
export const module={data,schemas,workState:{route:data.key,title:data.name,description:'Host admission probe',schema:schemas.work,schemaVersion:data.work.version}};`;
}
