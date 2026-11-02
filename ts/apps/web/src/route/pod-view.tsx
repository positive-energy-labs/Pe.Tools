import { createElement } from "react";
import * as kit from "@pe/kit";
import { z } from "zod";
import * as contracts from "@pe/agent-contracts";
import { mountRoute, type RouteAdapters } from "#/shell/mount";
import { operationVerb, workVerb } from "#/shell/verbs";
import { podRead } from "./pod-sources";
import { podRoutePath } from "./pod-address";
export type PodRouteBundle = contracts.PodModuleBundle;

// TODO: Prove native Pod preview/apply/readback on a controlled Revit session; fixture Work is local and native commands intentionally stay refused.
/** Pods use the builtin mount. Bodies get only the readings their pane declares. */
export function makePodRoute(row: contracts.PodRouteDescriptor, bundle: PodRouteBundle) {
  if (!row.trusted) throw Error("Trust this Pod route hash before loading.");
  contracts.validatePodBundle(bundle);
  const module = bundle.register({ ...contracts, z, descriptor: row });
  contracts.validatePodDeclaration(module);
  const graph = module.graph;
  if (graph.key !== row.workRoute || graph.directory?.path !== podRoutePath(row.key))
    throw Error("Pod route identity must match its registered member");
  const sources: Record<string, import("#/shell/readings").ReadingSource> = {};
  for (const [key, select] of Object.entries(module.readings)) {
    if (module.entries[key]?.effect !== "query") throw Error("Pod reading requires a query entry");
    sources[key] = {
      kind: "use",
      dirties: ["snapshot"],
      key: (scope) => select(scope.page, scope.work),
      async open(context, deliver) {
        const input = select(context.page, context.work);
        if (input === null) return deliver({ kind: "complete", value: null, revision: 0 });
        try {
          const value = await podRead.run({ key, input }, { target: context.target } as never);
          if (!context.signal.aborted) deliver({ kind: "complete", value, revision: 1 });
        } catch (error) {
          if (!context.signal.aborted) deliver({ kind: "failure", error });
        }
      },
    };
  }
  for (const [key, derive] of Object.entries(module.derives ?? {})) {
    sources[key] = {
      kind: "derive",
      key: scope => [scope.page, scope.workRevision],
      derive: (context) =>
        derive(
          context.page,
          context.work,
          Object.fromEntries(
            Object.entries(context.inputs).map(([id, value]) => [id, value.value]),
          ),
        ),
    };
  }
  graph.verbs = Object.fromEntries(
    Object.entries(graph.verbs).map(([id, declaration]) => {
      if (declaration.kind === "work") {
        const patches = module.edits?.[id];
        if (!patches) throw Error(`Missing Pod Work body: ${id}`);
        return [
          id,
          workVerb(declaration, {
            patches: (scope, input) => patches(scope.snapshot.work?.doc, input),
          }),
        ];
      }
      if (declaration.kind !== "command" || !declaration.does || !module.entries[declaration.does])
        throw Error(`Missing Pod command body: ${id}`);
      const key = declaration.does;
      const verb = operationVerb(podRead, declaration, {
        raw: (scope, input) => ({
          key,
          input: { ...(input as object), work: scope.snapshot.work?.handle },
        }),
        intent: (_scope, input) => ({ key, input: input as Record<string, unknown> }),
      });
      verb.does = key;
      return [id, verb];
    }),
  );
  const renderers = module.renderers({ h: createElement, kit });
  const adapters: RouteAdapters<any, any> = {
    sources,
    binding: (_id, row) => ({ subject: null, args: row ?? {} }),
    bodies: Object.fromEntries(
      Object.entries(renderers).map(([id, render]) => [
        id,
        (body) => {
          const pane = graph.panes[id];
          if (!pane) throw Error(`Undeclared Pod pane: ${id}`);
          const readings = new Proxy(
            Object.fromEntries(pane.draws.map((key) => [key, body.owner.readings.get(key).value])),
            {
              get(values, key) {
                if (typeof key === "string" && !pane.draws.includes(key))
                  throw Error(`Undeclared Pod reading: ${key}`);
                return Reflect.get(values, key);
              },
            },
          );
          return render({
            page: body.page,
            work: body.owner.snapshot().work?.doc,
            readings,
            setPage: (patch: Record<string, unknown>) => body.owner.view.setPage(patch),
            run: (verb: string, input: unknown) => body.owner.control(verb, input).run(),
            verbs: body.verbs,
          });
        },
      ]),
    ),
  };
  const registration = { ...module, bodies: adapters };
  contracts.validateRouteModule(registration);
  const View = mountRoute(graph, adapters);
  return {
    registration,
    graph,
    manifest: graph,
    adapters,
    hosted: ({
      visible,
      ...props
    }: {
      visible: boolean;
      thread: string;
      target?: string;
      work?: string;
    }) => <View {...props} hidden={!visible} url={false} />,
  };
}
