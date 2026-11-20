import { z } from "zod";
import {
  documentRefSchema,
  type executionTargetSchema,
  workKeySchema,
  bindWork,
  NATIVE_BODY_VERSION_HEADER,
} from "@pe/agent-contracts";
import type { HostOperationKey } from "@pe/host-contracts/operation-types";
import {
  leaf,
  nativeArgs,
  nativeRead,
  type InputPort,
  RefusedPartition,
} from "@pe/host-internal/reads/evaluator";
import { workBinding } from "@pe/host-internal/reads/work";
import type { RouteWorkspace, WorkReadContext } from "@pe/runtime";
import { workTimelineInput } from "./work-timeline.ts";
import type { HostMarks } from "../document-marks.ts";
import type { WorkInputRunner } from "../work-inputs.ts";
import type { InputConsumption } from "@pe/host-internal/input-occurrence";
import { BridgeError } from "@pe/host-internal/bridge";
import { BridgeError as InputBridgeError } from "@pe/host-internal/dispatch";
import type { ReadingDemand } from "@pe/host-internal/native-read";

export interface ReadSources {
  inputs?: { consumption: InputConsumption; run: WorkInputRunner; work: WorkReadContext };
  workKey: (target: z.output<typeof documentRefSchema>) => Promise<z.output<typeof workKeySchema>>;
  resource: (request: unknown) => Promise<unknown>;
  file: (name: string, args: unknown) => Promise<unknown>;
  call: (
    key: string,
    request: unknown,
    target: z.output<typeof executionTargetSchema>,
    version: string | undefined,
    role: "acquire" | "validate" | "join" | "beyond" | "none",
    /** The read's own lifetime (evaluator.ts): the native call stops when the read's last subscriber released. */
    signal?: AbortSignal,
    demand?: ReadingDemand,
    label?: string,
  ) => Promise<Response>;
}
export function inputPort(options: {
  source: ReadSources;
  workspace: RouteWorkspace;
  marks: HostMarks;
  run: WorkInputRunner;
  evaluation: string;
  origin: () => unknown;
  revision: InputPort["revision"];
  leaves?: import("@pe/agent-contracts").HostRouteModule["leaves"];
  /** Absent on a lane with no action journal: the Timeline is then refused, never built without receipts. */
  timeline?: import("./work-timeline.ts").HostTimeline;
}): InputPort {
  const port: InputPort = {
    evaluation: options.evaluation,
    get origin() {
      return options.origin();
    },
    revision: options.revision,
    async take(name, raw, context, signal, demand, label) {
      const source = options.source;
      const custom = options.leaves?.[name];
      if (custom)
        return custom(raw, {
          ...port,
          take: async (key, args) =>
            context
              ? context.read(leaf(key, z.unknown(), z.unknown()), args)
              : port.take(key, args),
        });
      if (name === "resource") return source.resource(raw);
      if (name.startsWith("local:")) return source.file(name, raw);
      if (name.startsWith("file:")) return source.file(name.slice(5), raw);
      if (name === "document-mark") {
        await options.marks.settled?.();
        return options.run(options.marks.snapshot(documentRefSchema.parse(raw)));
      }
      if (name === "work-scope") {
        const document = documentRefSchema.safeParse(raw);
        if (document.success) return source.workKey(document.data);
        const request = workBinding.input.parse(raw);
        if (request.work === null) return null;
        if (request.work !== undefined) return bindWork(request.route, null, request.work);
        const target = request.target,
          ref =
            target &&
            ("kind" in target ? (target.kind === "document" ? target.ref : null) : target);
        return ref
          ? { ...(await source.workKey(ref)), route: request.route }
          : bindWork(request.route, null);
      }
      if (name === "work-timeline") {
        if (!options.timeline) throw Error("The Timeline needs the host's action journal");
        const { works, by, document } = workTimelineInput.input.parse(raw);
        return options.timeline.read(works, by, document);
      }
      if (name === "work") {
        const { owner, scope } = z.object({ owner: z.string(), scope: workKeySchema }).parse(raw);
        // Pure evaluator compositions inspect Work without a recording owner.
        return source.inputs
          ? options.workspace.view(scope, owner, source.inputs.work)
          : options.workspace.viewUncaptured(scope, owner);
      }
      if (name === "native") {
        const args = nativeArgs.parse(raw);
        // The port is the boundary: a hand-built native leaf meets the same catalog Read check.
        nativeRead(args.key as HostOperationKey);
        let response: Response;
        try {
          response = await source.call(
            args.key,
            args.request,
            args.target,
            args.version,
            args.role ?? "none",
            signal,
            demand,
            label,
          );
        } catch (error) {
          if (
            (error instanceof BridgeError || error instanceof InputBridgeError) &&
            error.outcome === "refused"
          )
            throw new RefusedPartition(error.message);
          throw error;
        }
        if (!response.ok) throw Error(await response.text());
        return {
          body: await response.json(),
          version: response.headers.get(NATIVE_BODY_VERSION_HEADER),
        };
      }
      throw Error(`Unknown input leaf '${name}'`);
    },
  };
  return port;
}
