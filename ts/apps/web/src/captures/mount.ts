import { z } from "zod";
import type { AdmittedRoute } from "../../../../packages/agent-contracts/src/route-kernel-admission";
import type { ReadingSnapshot } from "../../../../packages/agent-contracts/src/route-kernel-bodies";
import { createRouteTokenIssuer } from "../../../../packages/agent-contracts/src/route-kernel-page";
import { createRouteEnvironmentIssuer } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import { createRouteScopeGate } from "../../../../packages/runtime/src/route-scope-gate";
import {
  createPagePolicy,
  createPagePorts,
  identityCodecs,
  selectionCodec,
} from "../shell/page-port";
import {
  createFixtureRouteEnvironment,
  selectRouteEnvironment,
  fixtureName,
} from "../shell/fixture-lane";
import { createRouteEnvironment, type EnvironmentOptions } from "../shell/route-environment";
import { mountAdmittedRoute } from "../shell/admitted-mount";
import { capturesData, schemas, captureId, entries } from "./kernel";
import { canonicalRouteJson } from "../../../../packages/agent-contracts/src/route-graph";
import type { UseSource } from "../shell/readings";
import { captureQueries } from "./host";

function freeze<T>(
  value: T,
): asserts value is T &
  import("../../../../packages/agent-contracts/src/route-kernel-data").Immutable<T> {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}
const pageSchema = z.object({
  sha: schemas.subject,
  selected: z.array(
    z.object({
      kind: z.literal("capture"),
      id: z.custom<ReturnType<typeof captureId>>(
        (v) => typeof v === "string" && identityCodecs.local.decode(v).ok,
      ),
    }),
  ),
  open: schemas.open,
});
export function createCapturesMount(
  route: AdmittedRoute,
  fingerprint: string,
  source: UseSource,
  search: Record<string, unknown>,
  changed: () => void,
) {
  const mount = mountAdmittedRoute(route, fingerprint);
  const { bindings } = mount.resolve();
  if (canonicalRouteJson(route.data) !== canonicalRouteJson(capturesData))
    throw Error("Capture declaration differs from admitted data");
  const policy = createPagePolicy(capturesData, schemas, () => "unresolved");
  const issuer = createRouteTokenIssuer();
  const initial = policy.initial();
  if (!initial.ok) throw Error(initial.reason);
  const owner = createRouteScopeGate({
    workSchema: z.never(),
    hashWork: JSON.stringify,
    journal: () => {
      throw Error("Captures has no Work");
    },
    dependencies: () => ({}),
    preparePage: policy.prepare,
    issuer,
  });
  owner.enter({ target: null, work: null }, initial.value);
  const ports = createPagePorts(capturesData, { ...owner, readPage: () => owner.read()!.page });
  const restore = (next: Record<string, unknown>) => {
    const state: Record<string, unknown> = {};
    if (typeof next.sha === "string") {
      // Existing shared links speak raw content hashes. Canonical kernel links carry local ids.
      const parsed = identityCodecs.local.decode(next.sha);
      state.sha = next.sha === "" ? null : parsed.ok ? parsed.value : captureId(next.sha);
    }
    if (typeof next.selected === "string") {
      const selected = selectionCodec(capturesData, ["capture"]).decode(next.selected);
      if (!selected.ok) throw Error(selected.reason);
      state.selected = selected.value;
    }
    if (typeof next.open === "string") {
      try {
        state.open = schemas.open.parse(JSON.parse(next.open));
      } catch {
        state.open =
          next.open === "all"
            ? { kind: "all" }
            : { kind: "ids", ids: next.open ? next.open.split(",") : [] };
      }
    }
    const restored = policy.restoreState(state, {});
    if (!restored.ok) throw Error(restored.reason);
    const result = owner.restorePage(restored.value, {
      kind: "restore",
      source: "url",
      token: issuer.restore("url"),
    });
    if (result.kind === "refused") throw Error(result.message);
  };
  restore(search);
  let reading: ReadingSnapshot<z.output<(typeof entries)["captures.list"]["output"]>> = {
    status: "pending",
    current: false,
    reason: "Reading captures",
  };
  const controller = new AbortController();
  const token = owner.capture("captures");
  const environmentIssuer = createRouteEnvironmentIssuer();
  const key = {
    op: "captures.list",
    processIncarnation: "host-metadata",
    documentLifetime: "none",
    sortedKeyInput: "{}",
    freshnessGeneration: 0,
  };
  const request = environmentIssuer.mintRead(key, entries["captures.list"].output, route);
  const environmentOptions: EnvironmentOptions = {
    issuer: environmentIssuer,
    validate: {
      admitted: (r) => r === route && !!mount.resolve(),
      token: (token) => owner.current(token),
      scope: (scope) => owner.current(scope),
      invocation: (invocation) => owner.current(invocation),
      detail: () => false,
      geometryScope: () => false,
      key: (k) => k === request.key,
    },
    ports: {
      reads: {
        lifetime: "read",
        acquire: <T>(
          req: import("../../../../packages/agent-contracts/src/route-kernel-environment").ResolvedRead<T>,
        ) => ({
          lifetime: "read",
          key: req.key,
          release: () => controller.abort(),
          read: () => {
            if (!reading.current) return { ...reading, value: undefined };
            const value = structuredClone(req.output.parse(reading.value));
            freeze(value);
            return { status: "ready", current: true, value, hash: reading.hash };
          },
        }),
      },
      readings: { lifetime: "subscription", subscribe: () => () => {} },
      geometry: {
        acquire: () => {
          throw Error("Captures has no geometry");
        },
      },
      work: {
        read: { lifetime: "read", read: () => null },
        submit: {
          lifetime: "command",
          submit: () => {
            throw Error("Captures has no Work");
          },
        },
      },
      clock: { lifetime: "read", now: Date.now },
      availability: { "captures.list": { available: true } },
    },
  };
  const fixture = fixtureName(search);
  const environment = selectRouteEnvironment({
    search,
    live: () => createRouteEnvironment(environmentOptions),
    fixture: (name) => {
      const seed =
        name === "browse"
          ? z
              .object({ readings: z.object({ captures: entries["captures.list"].output }) })
              .parse(bindings.bodies.browse!.run()).readings.captures
          : undefined;
      return createFixtureRouteEnvironment({
        ...environmentOptions,
        seed: seed ? { readings: { "captures.list": seed } } : undefined,
        workSpec: {
          route: "captures",
          title: "Captures",
          description: "No Work",
          schema: z.never(),
        },
        now: Date.now,
      });
    },
  });
  const handle = environment.environment.reads.acquire(request, token);
  const publish = (value: unknown) => {
    if (!owner.current(token) || controller.signal.aborted) return;
    const parsed = entries["captures.list"].output.parse(value);
    reading = { status: "ready", current: true, value: parsed, hash: JSON.stringify(parsed) };
    changed();
  };
  const releaseSource =
    fixture !== null
      ? undefined
      : source.open(
          {
            target: { kind: "host" },
            workKey: null,
            workRevision: null,
            page: {},
            work: null,
            attempt: { target: { kind: "host" }, workKey: null, generation: 0 },
            trigger: { kind: "demand" },
            args: {},
            inputs: {},
            signal: controller.signal,
          },
          (frame) => {
            if (frame.kind === "complete") publish(frame.value);
            if (frame.kind === "failure" && owner.current(token)) {
              reading = { status: "failed", current: false, reason: String(frame.error) };
              changed();
            }
          },
        );
  const unsubscribe = owner.subscribe(changed);
  return {
    owner,
    ports,
    restore,
    read() {
      const current = mount.resolve();
      const result = z
        .object({
          reading: z.union([
            z.object({
              current: z.literal(true),
              status: z.literal("ready"),
              value: entries["captures.list"].output,
              hash: z.string(),
            }),
            z.object({
              current: z.literal(false),
              status: z.enum(["pending", "failed", "unavailable"]),
              reason: z.string(),
              value: entries["captures.list"].output.optional(),
            }),
          ]),
          page: pageSchema,
        })
        .parse(
          current.bindings.bodies.main!.run({
            page: ports.page,
            work: null,
            readings: { captures: handle.read() },
            visible: true,
            verbs: {},
          }),
        );
      return { page: result.page, reading: result.reading };
    },
    async refresh() {
      mount.resolve();
      if (fixture !== null) {
        changed();
        return;
      }
      if (!owner.current(token)) throw Error("Capture read retired");
      publish(
        await captureQueries["captures.list"].run({}, { target: { kind: "host" }, work: null }),
      );
    },
    close() {
      owner.close();
      unsubscribe();
      environment.close();
      mount.close();
      void Promise.resolve(releaseSource).then((release) => release?.());
    },
    bindings,
  };
}
