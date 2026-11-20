import { productReads } from "../product-executors.generated.ts";
import { routeRegistry } from "../routes.generated.ts";
import { placesRead, readPlaces } from "../places.ts";
import { valueReadRequest, type HostRouteModule } from "@pe/agent-contracts";
import { usesOf } from "@pe/agent-contracts/handle";
import {
  bodyOf,
  evaluate,
  fingerprint,
  type InputPort,
  type Read,
} from "@pe/host-internal/reads/evaluator";
import type { Publication, Publications } from "./publications.ts";
import { withTimelineCaller, workTimelineRead } from "./work-timeline.ts";
import { WORK_TIMELINE_READ, admittedRouteEntries, type WorkAuthor } from "@pe/agent-contracts";
import { z } from "zod";
import { hostOpCatalog } from "@pe/host-contracts/catalog";
import { linkedCatalog } from "@pe/mcps/product-catalog";
import { read } from "@pe/host-internal/read-graph";
import { FINDINGS_DOORS, findingsGuide, findingsCommands } from "@pe/agent-contracts/slots";

/** The host joins the wire's entry keys; no executable route code reaches Pea. */
export function projectRouteRead(module: Pick<HostRouteModule, "data" | "schemas">) {
  const { data, schemas } = module;
  const catalog = linkedCatalog().entries;
  return {
    ...data,
    // Kernel doors are available on every route, never declared or placed by the route.
    findings: Object.fromEntries(
      Object.values(FINDINGS_DOORS).map((entry) => {
        const command = findingsCommands[entry];
        return [
          entry,
          {
            entry,
            description: findingsGuide[entry],
            input: z.toJSONSchema(command.input),
            effect: command.catalogEffect,
          },
        ];
      }),
    ),
    fields: Object.fromEntries(
      Object.entries(data.fields).map(([id, field]) => {
        if (!("schema" in field)) return [id, field];
        const schema = schemas[field.schema];
        if (!schema) throw Error(`Route ${data.key}: missing field schema ${field.schema}`);
        return [id, { ...field, schema: z.toJSONSchema(schema, { io: "input" }) }];
      }),
    ),
    verbs: Object.fromEntries(
      Object.entries(data.verbs).map(([id, verb]) => {
        const entry = catalog.get(`command:${verb.entry}`) ?? catalog.get(verb.entry);
        const native = hostOpCatalog.find((op) => op.key === verb.entry);
        const admitted = [...admittedRouteEntries.values()]
          .filter((row) => row.available())
          .map((row) => row.entries[verb.entry])
          .find(Boolean);
        const input = admitted
          ? z.toJSONSchema(admitted.input)
          : (entry?.discovery?.input ??
            (native?.requestSchemaJson ? JSON.parse(native.requestSchemaJson) : undefined));
        if (!input) throw Error(`Route ${data.key}: missing catalog input for ${verb.entry}`);
        return [id, { ...verb, input }];
      }),
    ),
  };
}
const routeDeclarationRead = (module: Pick<HostRouteModule, "data" | "schemas">) =>
  read(`route:${module.data.key}`, {
    input: z.strictObject({}),
    output: z.unknown(),
    run: () => projectRouteRead(module),
  });

export const graphRouteIds = ["reads.value"];
function bind<I, O>(
  definition: Read<I, O>,
  args: I,
  publication: {
    subscription: string;
    generation: number;
    release?: boolean;
    readSet?: string;
  } | null = null,
) {
  return {
    name: definition.name,
    key: fingerprint([definition.name, definition.input.parse(args)]),
    args,
    publication,
    readSet: publication?.readSet,
    evaluate: async (port: InputPort) => (await evaluate(definition, args, port)).data,
    publish: (
      owner: Publications,
      id: string,
      generation: number,
      port: InputPort,
      keep?: (publication: Publication<unknown>) => Promise<() => void>,
      admitted?: ReturnType<Publications["admission"]>,
    ) => owner.publish(id, generation, definition, args, port, keep, admitted),
  };
}
export interface HostReadRegistry {
  readonly reads: Map<string, NonNullable<HostRouteModule["reads"]>[string]>;
  readonly leaves: Record<string, NonNullable<HostRouteModule["leaves"]>[string]>;
  register(definitions?: HostRouteModule["reads"], inputs?: HostRouteModule["leaves"]): () => void;
}
/** Trusted host modules extend the graph without an endpoint or port branch. */
export function readRegistry(
  modules: readonly Pick<HostRouteModule, "reads" | "leaves">[],
): HostReadRegistry {
  const reads = new Map<string, Read<any, any>>();
  const leaves: Record<string, NonNullable<HostRouteModule["leaves"]>[string]> =
    Object.create(null);
  const serviceInputs = new Set([
    "native",
    "resource",
    "work",
    "work-scope",
    "work-timeline",
    "document-mark",
  ]);
  const register = (
    definitions: HostRouteModule["reads"] = {},
    inputs: HostRouteModule["leaves"] = {},
  ) => {
    const incoming = Object.values(definitions),
      names = new Set<string>();
    for (const definition of incoming) {
      if (reads.has(definition.name) || names.has(definition.name))
        throw Error(`Duplicate host read ${definition.name}`);
      names.add(definition.name);
      // A composition joins here, not at its first read: every key its contract uses has a body
      // (a route's, registered when its module loaded, or the native door's), or it does not register.
      for (const key of definition.contract ? usesOf(definition.contract) : [])
        try {
          bodyOf({ key });
        } catch {
          throw Error(`Host read ${definition.name} uses '${key}', which has no body on this host`);
        }
    }
    for (const name of Object.keys(inputs))
      if (
        Object.hasOwn(leaves, name) ||
        serviceInputs.has(name) ||
        name.startsWith("file:") ||
        name.startsWith("local:")
      )
        throw Error(`Duplicate host leaf ${name}`);
    for (const definition of incoming) reads.set(definition.name, definition);
    Object.assign(leaves, inputs);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      for (const definition of incoming)
        if (reads.get(definition.name) === definition) reads.delete(definition.name);
      for (const [name, take] of Object.entries(inputs))
        if (leaves[name] === take) delete leaves[name];
    };
  };
  for (const module of modules) register(module.reads, module.leaves);
  return { reads, leaves, register };
}
// The Timeline is the kernel's read, not a route's: it is registered beside the route modules.
export const registeredReads: HostReadRegistry = readRegistry([
  ...productReads,
  ...Object.values(routeRegistry).map((route) => route.host),
  { reads: { [WORK_TIMELINE_READ]: workTimelineRead } },
]);
registeredReads.register({ places: placesRead }, { places: async () => readPlaces() });
registeredReads.register(
  Object.fromEntries(
    Object.values(routeRegistry).map(({ key, host }) => [
      `route:${key}`,
      routeDeclarationRead(host),
    ]),
  ),
);
/** HTTP adapters select a read; composition and freshness belong to the evaluator. */
/** `by` is the request's author: the one per-caller read (`work.timeline`) is stamped with it here. */
export function graphRoute(
  id: string,
  raw: unknown,
  registry: HostReadRegistry = registeredReads,
  by: WorkAuthor | null = null,
) {
  if (!graphRouteIds.includes(id)) throw Error(`Unknown read door: ${id}`);
  const request = valueReadRequest.parse(raw),
    definition = registry.reads.get(request.read);
  if (!definition) throw Error(`Host read is not registered: ${request.read}`);
  return bind(
    definition,
    definition.input.parse(withTimelineCaller(request.read, request.args, by)),
    request,
  );
}
