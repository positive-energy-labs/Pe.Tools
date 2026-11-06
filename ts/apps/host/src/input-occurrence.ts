/**
 * Host input occurrences (docs/features/routes/GLOSSARY.md): which exact taking each consumer read. An
 * admitted consumer opens one context; every input it starts reserves its occurrence synchronously,
 * before any await, per (input identity, scope) within that context. Capture binds the reservation
 * to the actual durable taking; replay selects by stored read-set id + input + scope + start, never
 * by scanning candidates, completion order or equal values. Metadata only: source data stays in the
 * owners' observations. Contexts travel by Effect service provision or an explicit bound runner.
 */
import { randomUUID } from "node:crypto";
import { Context, Effect, Layer, Result } from "effect";
import { canonicalJson } from "@pe/host-internal/native-read";
import { InvalidRead } from "./native-reads.ts";
import {
  inputIdentity,
  type ConsumerRecipe,
  type HostInputLane,
  type InputReadSetRecord,
  type RecordedInput,
  type RecordingReader,
  type RecordingWriter,
  type Taking,
  type TakingObserver,
} from "./native-recording.ts";

export type { ConsumerRecipe } from "./native-recording.ts";
declare const readSetBrand: unique symbol;
/** Host-minted before first consumption; never derived from a request, a time or an ordinal. */
export type ReadSetId = string & { readonly [readSetBrand]: "ReadSetId" };

export interface InputOccurrence {
  readonly readSet: ReadSetId;
  readonly input: RecordedInput;
  readonly scope: string;
  /** Zero-based, per (inputIdentity(input), scope), within this context. */
  readonly start: number;
}
export interface InputAttempt {
  readonly occurrence: InputOccurrence;
  /** The exact durable taking this occurrence read (replay only). */
  readonly selected: Effect.Effect<string, InvalidRead>;
  /** Binds this attempt to the actual taking its capture appended. */
  readonly observed: TakingObserver;
}
export interface InputConsumption {
  readonly id: ReadSetId;
  readonly recipe: ConsumerRecipe;
  readonly child: (recipe: ConsumerRecipe) => Result.Result<InputConsumption, InvalidRead>;
  readonly start: (input: RecordedInput, scope: string) => Result.Result<InputAttempt, InvalidRead>;
  readonly linkTaking: (name: string, takingId: string) => Effect.Effect<void, InvalidRead>;
  readonly taking: (name: string) => Effect.Effect<string, InvalidRead>;
  readonly linkReadSet: (name: string, id: ReadSetId) => Effect.Effect<void, InvalidRead>;
  readonly dependency: (name: string) => Effect.Effect<ReadSetId, InvalidRead>;
  readonly exportBasis: (basis: string) => Effect.Effect<void, InvalidRead>;
  readonly seal: Effect.Effect<void, InvalidRead>;
  /** Idempotent; an unsealed context stays incomplete and never synthesizes links. */
  readonly close: Effect.Effect<void>;
}
export interface InputReadSetLimits {
  readonly openRoots: number;
  readonly childrenPerRoot: number;
  readonly startsPerRoot: number;
  readonly metadataBytesPerRoot: number;
  readonly dependencyDepth: number;
}
export const defaultReadSetLimits: InputReadSetLimits = {
  openRoots: 64,
  childrenPerRoot: 128,
  startsPerRoot: 4096,
  metadataBytesPerRoot: 1024 * 1024,
  dependencyDepth: 16,
};

/** The consumption a boundary reads under; provided per request or frame, never global. */
export class CurrentInputConsumption extends Context.Service<
  CurrentInputConsumption,
  InputConsumption
>()("pe/CurrentInputConsumption") {}
/** An attempt a boundary reserved before entering a Promise owner; lower helpers reuse it. */
export class CurrentInputAttempt extends Context.Service<CurrentInputAttempt, InputAttempt>()(
  "pe/CurrentInputAttempt",
) {}

const refuse = (problem: string, message: string) =>
  new InvalidRead({ message, status: 409, problem: `recording.${problem}` });
const occurrenceKey = (input: RecordedInput, scope: string) =>
  canonicalJson([inputIdentity(input), scope]);
const recipeKey = (recipe: ConsumerRecipe) =>
  canonicalJson([recipe.key, recipe.input, recipe.scope]);
const mint = () => randomUUID() as ReadSetId;

/** One root tree's shared budget. Lifetime is per node: a child closes only itself and below. */
interface Budget {
  children: number;
  starts: number;
  /** A child past its cap was detached: this tree can never publish a complete read set. */
  lost?: boolean;
}
type Life = "open" | "sealed" | "closed";
/** A node accepts starts and mutations only while it and every ancestor are open. */
const lifetime = (parentOpen: () => boolean) => {
  let life: Life = "open";
  return {
    open: () => life === "open" && parentOpen(),
    end: (to: Exclude<Life, "open">) => {
      if (life === "closed" || life === to) return false;
      life = to;
      return true;
    },
  };
};
const closed = () => refuse("context", "This consumption is sealed or closed");
/** A mutation that refuses once the node is sealed or closed. */
const whileOpen = (open: () => boolean, mutate: () => Effect.Effect<void, InvalidRead>) =>
  Effect.suspend(() => (open() ? mutate() : Effect.fail(closed())));
const nextOf = (counters: Map<string, number>) => (key: string) => {
  const start = counters.get(key) ?? 0;
  counters.set(key, start + 1);
  return start;
};
/** A dependency binds once; the same id again is a no-op, another id refuses. */
const bindOnce = (dependencies: Record<string, string>, name: string, id: string) =>
  name in dependencies
    ? dependencies[name] === id
      ? Effect.void
      : Effect.fail(refuse("ambiguous", `Dependency ${name} is already bound`))
    : Effect.sync(() => {
        dependencies[name] = id;
      });

type LiveNode = InputConsumption & {
  readonly record: () => InputReadSetRecord | null;
  readonly childNodes: () => readonly LiveNode[];
};
/** Live capture: reservations bound to the takings their captures append; sealed into the store. */
function liveContext(
  writer: RecordingWriter | undefined,
  recipe: ConsumerRecipe,
  budget: Budget,
  limits: InputReadSetLimits,
  parentOpen: () => boolean,
  release: () => void,
): LiveNode {
  const id = mint();
  const life = lifetime(parentOpen);
  const next = nextOf(new Map());
  const inputs: { input: RecordedInput; scope: string; start: number; takingId: string | null }[] =
    [];
  const children: { recipe: ConsumerRecipe; start: number; node: LiveNode }[] = [];
  const takingLinks: Record<string, string> = {};
  const dependencies: Record<string, string> = {};
  const exports: { kind: "ducts.sheet"; basis: string }[] = [];
  const record = (): InputReadSetRecord | null => {
    if (!writer) return null;
    const complete =
      inputs.every((entry) => entry.takingId !== null) &&
      children.every((child) => child.node.record()?.state === "complete");
    return {
      version: 1,
      id,
      identity: writer.identity,
      recipe,
      state: complete ? "complete" : "incomplete",
      inputs: inputs.flatMap((entry) =>
        entry.takingId === null
          ? []
          : [
              {
                input: entry.input,
                scope: entry.scope,
                start: entry.start,
                takingId: entry.takingId,
              },
            ],
      ),
      children: children.map((child) => ({
        recipe: child.recipe,
        start: child.start,
        readSetId: child.node.id,
      })),
      takingLinks: { ...takingLinks },
      dependencies: { ...dependencies },
      exports: [...exports],
    };
  };
  const self: LiveNode = {
    id,
    recipe,
    record,
    childNodes: () => children.map((child) => child.node),
    child: (childRecipe) => {
      if (!life.open()) return Result.fail(closed());
      // Past the cap, live computation continues in a detached child; capture is what is lost (K4).
      if (budget.children + 1 > limits.childrenPerRoot) {
        budget.lost = true;
        return Result.succeed(detachedContext(childRecipe, life.open));
      }
      budget.children++;
      const node = liveContext(writer, childRecipe, budget, limits, life.open, () => {});
      children.push({ recipe: childRecipe, start: next(recipeKey(childRecipe)), node });
      return Result.succeed(node);
    },
    start: (input, scope) => {
      if (!life.open()) return Result.fail(closed());
      if (budget.starts + 1 > limits.startsPerRoot)
        return Result.fail(refuse("full", "This consumption has too many input starts"));
      budget.starts++;
      const entry = {
        input,
        scope,
        start: next(occurrenceKey(input, scope)),
        takingId: null as string | null,
      };
      inputs.push(entry);
      return Result.succeed({
        occurrence: { readSet: id, input, scope, start: entry.start },
        selected: Effect.fail(refuse("context", "A live attempt selects no recorded taking")),
        observed: (taking: Taking) =>
          whileOpen(life.open, () =>
            inputIdentity(taking.input) !== inputIdentity(input) || taking.scope !== scope
              ? Effect.fail(refuse("mismatch", "The appended taking is not this attempt's input"))
              : entry.takingId !== null
                ? Effect.fail(refuse("ambiguous", "This attempt already holds a taking"))
                : Effect.sync(() => {
                    entry.takingId = taking.id;
                  }),
          ),
      });
    },
    linkTaking: (name, takingId) =>
      whileOpen(life.open, () =>
        name in takingLinks && takingLinks[name] !== takingId
          ? Effect.fail(refuse("ambiguous", `Taking link ${name} is already bound`))
          : Effect.sync(() => {
              takingLinks[name] = takingId;
            }),
      ),
    taking: (name) =>
      Effect.suspend(() =>
        name in takingLinks
          ? Effect.succeed(takingLinks[name]!)
          : Effect.fail(refuse("miss", `No taking link ${name}`)),
      ),
    linkReadSet: (name, readSet) =>
      whileOpen(life.open, () => bindOnce(dependencies, name, readSet)),
    dependency: (name) =>
      Effect.suspend(() =>
        name in dependencies
          ? Effect.succeed(dependencies[name] as ReadSetId)
          : Effect.fail(refuse("miss", `No read-set dependency ${name}`)),
      ),
    exportBasis: (basis) =>
      whileOpen(life.open, () =>
        Effect.sync(() => {
          if (!exports.some((entry) => entry.basis === basis))
            exports.push({ kind: "ducts.sheet", basis });
        }),
      ),
    seal: Effect.suspend(() => {
      if (!life.open()) return Effect.fail(closed());
      life.end("sealed");
      // A truncated capture never publishes a complete read set.
      if (!writer || writer.capture.truncated()) return Effect.void;
      if (budget.lost) {
        const at = writer.capture.begin();
        return at === null ? Effect.void : writer.capture.stop(at, "full");
      }
      const records: InputReadSetRecord[] = [];
      const walk = (node: LiveNode) => {
        const value = node.record();
        if (value) records.push(value);
        node.childNodes().forEach(walk);
      };
      walk(self);
      const bytes = records.reduce(
        (sum, value) => sum + Buffer.byteLength(JSON.stringify(value)),
        0,
      );
      if (bytes > limits.metadataBytesPerRoot) {
        const at = writer.capture.begin();
        return at === null ? Effect.void : writer.capture.stop(at, "full");
      }
      // Children before parents, so every durable link resolves.
      return Effect.forEach(records.reverse(), (value) => writer.readSets.keep(value), {
        discard: true,
      }).pipe(
        Effect.catch(() => {
          const at = writer.capture.begin();
          return at === null ? Effect.void : writer.capture.stop(at, "io");
        }),
      );
    }),
    close: Effect.sync(() => {
      if (life.end("closed")) release();
    }),
  };
  return self;
}

/**
 * A live context beyond its capture budget: it keeps lifetime fences but records nothing. Its
 * starts refuse `full`, which the capture boundary turns into a capture stop with the live answer
 * kept; it never publishes a read set.
 */
function detachedContext(recipe: ConsumerRecipe, parentOpen: () => boolean): InputConsumption {
  const life = lifetime(parentOpen);
  const lost = () => refuse("full", "This consumption is past its capture budget");
  const ignored = () => whileOpen(life.open, () => Effect.void);
  return {
    id: mint(),
    recipe,
    child: (childRecipe) =>
      life.open() ? Result.succeed(detachedContext(childRecipe, life.open)) : Result.fail(closed()),
    start: () => Result.fail(life.open() ? lost() : closed()),
    linkTaking: ignored,
    taking: () => Effect.fail(lost()),
    linkReadSet: ignored,
    dependency: () => Effect.fail(lost()),
    exportBasis: ignored,
    seal: Effect.suspend(() => (life.end("sealed") ? Effect.void : Effect.fail(closed()))),
    close: Effect.sync(() => void life.end("closed")),
  };
}

/** A stored read-set tree, preloaded at open so every start/child selects synchronously. */
interface Loaded {
  readonly record: InputReadSetRecord;
  readonly children: ReadonlyMap<string, Loaded>;
}
/** The whole replay graph shares one budget: nodes beyond the root, bytes, and depth. */
const load = (
  reader: RecordingReader,
  id: string,
  limits: InputReadSetLimits,
  budget: { nodes: number; bytes: number } = { nodes: -1, bytes: 0 },
  path: readonly string[] = [],
): Effect.Effect<Loaded, InvalidRead> =>
  Effect.gen(function* () {
    if (path.includes(id)) return yield* refuse("mismatch", `Read set ${id} depends on itself`);
    if (path.length > limits.dependencyDepth)
      return yield* refuse("full", "Read-set dependencies are too deep");
    if (++budget.nodes > limits.childrenPerRoot)
      return yield* refuse("full", "This read-set graph has too many nodes");
    const record = yield* reader.readSets.get(id);
    budget.bytes += Buffer.byteLength(JSON.stringify(record));
    if (budget.bytes > limits.metadataBytesPerRoot)
      return yield* refuse("full", "This read-set graph exceeds its metadata bound");
    if (record.state !== "complete")
      return yield* refuse("context", `Read set ${id} is incomplete`);
    const children = new Map<string, Loaded>();
    for (const child of record.children) {
      const key = canonicalJson([recipeKey(child.recipe), child.start]);
      if (children.has(key))
        return yield* refuse("ambiguous", `Read set ${id} names one child occurrence twice`);
      const loaded = yield* load(reader, child.readSetId, limits, budget, [...path, id]);
      if (recipeKey(loaded.record.recipe) !== recipeKey(child.recipe))
        return yield* refuse("mismatch", `Child read set ${child.readSetId} has another recipe`);
      children.set(key, loaded);
    }
    // Dependencies must resolve and stay acyclic; they are opened by their own consumer.
    for (const dependency of Object.values(record.dependencies))
      yield* load(reader, dependency, limits, budget, [...path, id]);
    return { record, children };
  });

/** Replay: every start and child resolves the stored occurrence, or refuses before any access. */
function recordedContext(loaded: Loaded, parentOpen: () => boolean = () => true): InputConsumption {
  const { record } = loaded;
  const life = lifetime(parentOpen);
  const next = nextOf(new Map());
  const id = record.id as ReadSetId;
  const same = (matches: boolean, what: string) =>
    whileOpen(life.open, () =>
      matches ? Effect.void : Effect.fail(refuse("mismatch", `${what} differs from the recording`)),
    );
  return {
    id,
    recipe: record.recipe,
    child: (recipe) => {
      if (!life.open()) return Result.fail(closed());
      const child = loaded.children.get(
        canonicalJson([recipeKey(recipe), next(recipeKey(recipe))]),
      );
      return child
        ? Result.succeed(recordedContext(child, life.open))
        : Result.fail(refuse("miss", `Read set ${id} holds no such child occurrence`));
    },
    start: (input, scope) => {
      if (!life.open()) return Result.fail(closed());
      const key = occurrenceKey(input, scope);
      const start = next(key);
      const entries = record.inputs.filter(
        (candidate) =>
          occurrenceKey(candidate.input, candidate.scope) === key && candidate.start === start,
      );
      if (entries.length > 1)
        return Result.fail(refuse("ambiguous", `Read set ${id} names occurrence ${start} twice`));
      if (!entries[0])
        return Result.fail(
          refuse("miss", `Read set ${id} holds no occurrence ${start} of this input`),
        );
      return Result.succeed({
        occurrence: { readSet: id, input, scope, start },
        selected: Effect.succeed(entries[0].takingId),
        observed: () => Effect.fail(refuse("historical", "A recording keeps no new taking")),
      });
    },
    linkTaking: (name, takingId) =>
      same(record.takingLinks[name] === takingId, `Taking link ${name}`),
    taking: (name) =>
      name in record.takingLinks
        ? Effect.succeed(record.takingLinks[name]!)
        : Effect.fail(refuse("miss", `Read set ${id} has no taking link ${name}`)),
    linkReadSet: (name, readSet) =>
      same(record.dependencies[name] === readSet, `Dependency ${name}`),
    dependency: (name) =>
      name in record.dependencies
        ? Effect.succeed(record.dependencies[name] as ReadSetId)
        : Effect.fail(refuse("miss", `Read set ${id} has no dependency ${name}`)),
    exportBasis: (basis) =>
      same(
        record.exports.some((entry) => entry.basis === basis),
        "The recomputed basis",
      ),
    seal: Effect.suspend(() => (life.end("sealed") ? Effect.void : Effect.fail(closed()))),
    close: Effect.sync(() => void life.end("closed")),
  };
}

/** The runtime owner of consumption contexts over the admitted bundle. */
export class HostInputReadSets extends Context.Service<
  HostInputReadSets,
  {
    readonly open: (
      recipe: ConsumerRecipe,
      selected: ReadSetId | null,
    ) => Effect.Effect<InputConsumption, InvalidRead>;
  }
>()("pe/HostInputReadSets") {
  static layer(lane: HostInputLane, limits: InputReadSetLimits = defaultReadSetLimits) {
    let open = 0;
    return Layer.succeed(HostInputReadSets, {
      open: (recipe, selected) =>
        Effect.suspend(() => {
          if (lane.kind === "fixture")
            return Effect.fail(refuse("fixture", "A fixture has no input source"));
          if (lane.kind === "recording") {
            if (selected === null)
              return Effect.fail(
                refuse("context", "A recording serves only an explicitly selected read set"),
              );
            return load(lane.recordingStore, selected, limits).pipe(
              Effect.flatMap((loaded) =>
                recipeKey(loaded.record.recipe) === recipeKey(recipe)
                  ? Effect.succeed(recordedContext(loaded))
                  : Effect.fail(
                      refuse("mismatch", `Read set ${selected} was taken by another consumer`),
                    ),
              ),
            );
          }
          if (selected !== null)
            return Effect.fail(refuse("context", "Live input selects no recorded read set"));
          // Past the cap, a live read still computes, in a detached context, while capture stops (K4).
          if (open + 1 > limits.openRoots) {
            const at = lane.captureStore?.capture.begin() ?? null;
            const stopped = at === null ? Effect.void : lane.captureStore!.capture.stop(at, "full");
            return Effect.as(
              stopped,
              detachedContext(recipe, () => true),
            );
          }
          open++;
          return Effect.succeed(
            liveContext(
              lane.captureStore,
              recipe,
              { children: 0, starts: 0 },
              limits,
              () => true,
              () => {
                open--;
              },
            ),
          );
        }),
    });
  }
}

/**
 * The attempt one input read runs under: a reserved CurrentInputAttempt (which must name this
 * exact input and scope), else a fresh start in the CurrentInputConsumption, else none at all
 * (a caller outside any consumer, served by the legacy exact-binding path).
 */
export const attemptFor = (input: RecordedInput, scope: string) =>
  Effect.gen(function* () {
    const reserved = yield* Effect.serviceOption(CurrentInputAttempt);
    if (reserved._tag === "Some")
      return occurrenceKey(reserved.value.occurrence.input, reserved.value.occurrence.scope) ===
        occurrenceKey(input, scope)
        ? Result.succeed(reserved.value)
        : Result.fail(refuse("mismatch", "The reserved attempt names another input or scope"));
    const consumption = yield* Effect.serviceOption(CurrentInputConsumption);
    return consumption._tag === "Some" ? consumption.value.start(input, scope) : null;
  });
