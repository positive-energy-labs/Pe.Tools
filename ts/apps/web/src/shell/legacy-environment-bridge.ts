/** S1c deletion inventory: verbs.ts defaults, fixture.ts, mount-work.tsx,
 * mount-owner.ts metadata, mount-readings-owner.ts and mount-work-owner.ts ports.
 * Legacy RouteGraph has no admitted handle. Keep its transports here until S1c
 * supplies the admission door; never forge an AdmittedRoute for this bridge. */
import { z } from "zod";
import type { ReadEntry } from "@pe/agent-contracts";
import type { CausalParentId } from "../../../../packages/agent-contracts/src/route-kernel-page";
import type { JournalCommandHandle } from "../../../../packages/agent-contracts/src/route-kernel-environment";
import {
  runSemanticAction,
  recoverAction,
  submitAction,
} from "../../../../packages/mcps/src/shared/takeoff-action-client";
import type { VerbSnapshot } from "./verbs";

export interface LegacySubmission<T> extends JournalCommandHandle {
  readonly result: Promise<T>;
}
/** Submission owns execution. UI disposal cannot rerun or cancel the journal entry. */
export function createSubmissionJournal() {
  const parents = new Set<string>();
  const parentSchema = z.custom<CausalParentId>(
    (value) => typeof value === "string" && parents.has(value),
  );
  return {
    submit<T>(id: string, execute: () => Promise<T>, parent?: CausalParentId): LegacySubmission<T> {
      parents.add(id);
      return Object.freeze({
        lifetime: "command",
        id,
        causalParent: parent ?? parentSchema.parse(id),
        result: Promise.resolve().then(execute),
      });
    },
  };
}
export interface LegacyVerbEnvironment {
  readonly fixture?: { name: string };
  readonly reads: {
    readonly lifetime: "read";
    query(
      read: ReadEntry,
      input: Record<string, unknown>,
      snapshot: VerbSnapshot,
    ): Promise<unknown>;
  };
  readonly commands: {
    readonly lifetime: "command";
    readonly refusal: string | null;
    semantic(
      ...args: Parameters<typeof runSemanticAction>
    ): LegacySubmission<Awaited<ReturnType<typeof runSemanticAction>>>;
    raw(
      id: string,
      key: string,
      input: Record<string, unknown>,
      snapshot: VerbSnapshot,
      wait: number,
    ): LegacySubmission<Awaited<ReturnType<typeof submitAction>>>;
  };
}
export function legacyVerbEnvironment(
  queries?: Readonly<Record<string, unknown>>,
  name = "",
): LegacyVerbEnvironment {
  const journal = createSubmissionJournal();
  const refusal = queries ? "Native commands unavailable in this environment" : null;
  const check = () => {
    if (refusal) throw Error(refusal);
  };
  return {
    fixture: queries ? { name } : undefined,
    reads: {
      lifetime: "read",
      async query(read, input, snapshot) {
        if (queries) {
          if (!Object.hasOwn(queries, read.key))
            throw Object.assign(Error(`Missing fixture seed: ${read.key}`), { status: 404 });
          return structuredClone(queries[read.key]);
        }
        return read.run(read.input.parse(input), {
          target: snapshot.target,
          work: snapshot.work?.handle ?? null,
        });
      },
    },
    commands: {
      lifetime: "command",
      refusal,
      semantic(...args) {
        check();
        const id = typeof args[5] === "function" ? args[5]() : (args[5] ?? crypto.randomUUID());
        args[5] = id;
        return journal.submit(id, () => runSemanticAction(...args));
      },
      raw(id, key, input, snapshot, wait) {
        check();
        return journal.submit(
          id,
          async () =>
            (await recoverAction(id, key, input, snapshot.target, "", wait)) ??
            (await submitAction({ id, key, input, target: snapshot.target }, "", wait)),
        );
      },
    },
  };
}
export const legacyLiveVerbs = legacyVerbEnvironment();

import { useEffect, useMemo, useState } from "react";
import type { RouteGraph } from "@pe/agent-contracts";
import { useRouteSearchSlice } from "../route/activity";
import { fixtureEnvironment, pendingFixtureEnvironment, fixtureName } from "./fixture";
import { selectRouteEnvironment } from "./fixture-lane";
export function useLegacyEnvironmentBridge<P, W>(graph: RouteGraph<P, W>) {
  const fixture = useRouteSearchSlice(fixtureName);
  const pendingLane = useMemo(
    () =>
      selectRouteEnvironment({
        search: fixture === null ? {} : { fixture },
        live: () => null,
        fixture: (name) => pendingFixtureEnvironment(graph, name),
      }),
    [graph, fixture],
  );
  const [loaded, setLoaded] = useState<{
    pending: typeof pendingLane;
    lane: Awaited<ReturnType<typeof fixtureEnvironment<P, W>>>;
  } | null>(null);
  useEffect(() => {
    if (fixture === null) return;
    let active = true;
    void fixtureEnvironment(graph, fixture).then((lane) => {
      if (active) setLoaded({ pending: pendingLane, lane });
    });
    return () => {
      active = false;
    };
  }, [graph, fixture, pendingLane]);
  const lane = loaded && loaded.pending === pendingLane ? loaded.lane : pendingLane;
  return lane;
}

export const legacyMountMetadata = (environment?: LegacyVerbEnvironment) => ({
  fixture: environment?.fixture,
});

/** An admitted mount must never fall back to the legacy transport while S1c switches dispatch. */
export const unavailableLegacyVerbs: LegacyVerbEnvironment = {
  reads: {
    lifetime: "read",
    query: async () => {
      throw Error("Use the admitted reading capability");
    },
  },
  commands: {
    lifetime: "command",
    refusal: "Use the admitted command capability",
    semantic: () => {
      throw Error("Use the admitted command capability");
    },
    raw: () => {
      throw Error("Use the admitted command capability");
    },
  },
};
