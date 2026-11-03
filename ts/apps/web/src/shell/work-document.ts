/** Canonical Work documents: one atom family for every spelling of a Work key. */
import * as Atom from "effect/reactivity/Atom";
import { Equal, Hash, Option } from "effect";
import {
  parseRouteDoc,
  workKey,
  type Reading,
  type RouteDocOf,
  type RouteStateSpec,
  type WorkKey,
} from "@pe/agent-contracts";
import { peReadings, type Readings } from "#/readings";
import { mapReading, readingAtom, previousOf } from "#/shell/readings-hooks";
import { isRecord, type Slice } from "./owner";

class RouteAtomKey implements Equal.Equal {
  constructor(
    readonly spec: RouteStateSpec<any>,
    readonly key: WorkKey,
    readonly resources: Readings,
    readonly admission?: {
      routeKey: string;
      fingerprint: import("../../../../packages/agent-contracts/src/route-kernel-admission").RouteFingerprint;
    },
  ) {}
  [Equal.symbol](that: Equal.Equal): boolean {
    return (
      that instanceof RouteAtomKey &&
      this.spec.route === that.spec.route &&
      this.resources === that.resources &&
      this.admission?.fingerprint === that.admission?.fingerprint &&
      workKey(this.key) === workKey(that.key)
    );
  }
  [Hash.symbol]() {
    return Hash.string(`${this.spec.route}\0${workKey(this.key)}`);
  }
}

const routeAtom = Atom.family((key: RouteAtomKey) => {
  const { spec } = key;
  const resource = readingAtom(
    { ...key.key, kind: "work", ...(key.admission && { admission: key.admission }) },
    key.resources,
  );
  return Atom.make((get) => {
    const result = get(resource);
    try {
      return mapReading(result, (raw): Slice<RouteDocOf<typeof spec>> => {
        if (raw === null) return { doc: null, revision: null };
        if (!isRecord(raw) || !Number.isInteger(raw.revision) || !("doc" in raw))
          throw Error("Work response has no document or revision");
        return {
          doc: parseRouteDoc(raw.doc, spec),
          revision: raw.revision as number,
        };
      });
    } catch (error) {
      const self = Option.getOrUndefined(get.self<Reading<Slice<RouteDocOf<typeof spec>>>>());
      const previous = self ? previousOf(self) : undefined;
      const failed: Reading<Slice<RouteDocOf<typeof spec>>> = {
        state: "failed",
        message: error instanceof Error ? error.message : String(error),
        ...(previous !== undefined && { previous }),
      };
      return failed;
    }
  }).pipe(Atom.withLabel(`${spec.route}/slice`));
});

export function docAtom<S extends RouteStateSpec<any>>(
  spec: S,
  key: WorkKey,
  resources: Readings = peReadings,
  admission?: {
    routeKey: string;
    fingerprint: import("../../../../packages/agent-contracts/src/route-kernel-admission").RouteFingerprint;
  },
): Atom.Atom<Reading<Slice<RouteDocOf<S>>>> {
  return routeAtom(new RouteAtomKey(spec, key, resources, admission));
}
