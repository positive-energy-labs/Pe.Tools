import { Effect, Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  familyRouteState,
  here,
  settingsRouteState,
  type FamilyDocument,
  type RouteStatePatch,
  type RouteStateWriteResult,
  type SettingsRouteDocument,
} from "@pe/agent-contracts";

import type { MasterTableState } from "#/components/master-table/model";
import {
  BUILD_OUTCOME_UNKNOWN,
  buildRefusals,
  readBuildReceipt,
  type BuildFacts,
  type BuildRefusal,
} from "#/family/build";
import {
  FAMILY_MODULE,
  type EvidenceSlice,
  type FamilyHost,
  type FamilySnapshot,
  type FieldState,
} from "#/family/host";
import { familyLane } from "#/family/lane";
import { initialDraft, savedFrom, type Draft, type Focus, type Overlay } from "#/family/model";
import { draftToPatches } from "#/family/project";
import { bridgeSelector } from "@pe/agent-contracts";
import { documentAddress, scopeSession } from "#/host/target";
import {
  createRouteStoreCore,
  docAtom,
  docWriter,
  expectRouteWrite,
  refuse,
  feed,
  hostRead,
  unbound,
  type Scope,
  type Slice,
} from "#/state/route-store";

type Setter<A> = A | ((previous: A) => A);
type Inspect = { kind: "part"; slug: string } | { kind: "param"; name: string } | null;
type Binding = { slug: string; property: string } | null;
type ArmedBuild = { token: string | null; reason: string } | null;
const table = (): MasterTableState => ({ filters: {}, sorts: [], query: "" });

type FamilySlices = {
  settings: Atom.Atom<AsyncResult.AsyncResult<Slice<SettingsRouteDocument>, Error>>;
  family: Atom.Atom<AsyncResult.AsyncResult<Slice<FamilyDocument>, Error>>;
};

export function createFamilyStore(deps: {
  source?: "fixture";
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  host: FamilyHost;
  slices?: FamilySlices;
  writers?: {
    settingsApply(patches: RouteStatePatch[]): Promise<RouteStateWriteResult>;
    settingsCommand(name: "open" | "save", input?: unknown): Promise<RouteStateWriteResult>;
    familyApply(patches: RouteStatePatch[]): Promise<RouteStateWriteResult>;
    familyCommand(
      name: "capture_evidence" | "build_evidence" | "plan" | "apply",
      input?: unknown,
    ): Promise<RouteStateWriteResult>;
  };
}) {
  const core = createRouteStoreCore("family", deps.registry);
  const { registry, owned, write, runVerb } = core;
  const runtimeFactory = Atom.context({ memoMap: Layer.makeMemoMapUnsafe() });
  const runtime = runtimeFactory(Layer.empty).pipe(Atom.autoDispose);
  Reflect.set(runtime.layer, "keepAlive", false);

  const settingsSlice = core.owned(
    "slice/settings",
    deps.slices?.settings ?? docAtom(settingsRouteState, deps.scope),
  );
  const familySlice = core.owned(
    "slice/family",
    deps.slices?.family ?? docAtom(familyRouteState, deps.scope),
  );
  const settingsWriter = docWriter(settingsRouteState, deps.scope, deps.registry, settingsSlice);
  const familyWriter = docWriter(familyRouteState, deps.scope, deps.registry, familySlice);
  const writers = deps.writers ?? {
    settingsApply: settingsWriter.apply,
    settingsCommand: settingsWriter.command,
    familyApply: familyWriter.apply,
    familyCommand: familyWriter.command,
  };
  const settingsDoc = Atom.make((get): SettingsRouteDocument | null => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const familyDoc = Atom.make((get): FamilyDocument | null => {
    const result = get(familySlice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  // ponytail: the world is the page Scope's session; rebinding is a `?target` navigation, not a doc write.
  // The host selector for this page: `doc:<Address>`, or `pin:<id>|doc:<Address>` when pinned.
  const target = Atom.make(() => bridgeSelector(deps.scope.scope) ?? "").pipe(
    owned("binding/world"),
  );
  const profile = Atom.make(
    (get) =>
      get(familyDoc)?.bindings.profile?.id ?? get(settingsDoc)?.documentId?.relativePath ?? "",
  ).pipe(owned("binding/profile"));
  const routeStage = Atom.make((get) => get(familyDoc)?.stage ?? "author").pipe(owned("stage"));
  const sessionsSource = runtime.atom(() => hostRead(["sessions"], deps.host.sessions));
  const sessionsResult = runtimeFactory
    .withReactivity(["sessions"])(
      Atom.swr(sessionsSource, { staleTime: "5 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const snapshotSource = runtime.atom((get) => {
    const documentId = get(settingsDoc)?.documentId;
    return documentId
      ? hostRead([documentId.moduleKey, documentId.rootKey, documentId.relativePath], () =>
          deps.host.settings(documentId),
        )
      : Effect.succeed(unbound<FamilySnapshot | null>(null, ["settings"]));
  });
  const snapshotResult = runtimeFactory
    .withReactivity(["settings"])(
      Atom.swr(snapshotSource, { staleTime: "30 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const snapshot = Atom.make((get) => {
    const result = get(snapshotResult);
    if (!AsyncResult.isSuccess(result) || !result.value.bound || !result.value.value) return null;
    const value = result.value.value;
    return value.documentId.moduleKey === FAMILY_MODULE.moduleKey &&
      value.documentId.rootKey === FAMILY_MODULE.rootKey &&
      (!get(profile) || value.documentId.relativePath === get(profile))
      ? value
      : null;
  }).pipe(owned("view/snapshot"));
  const fields = Atom.make(
    (get) => (get(settingsDoc)?.fields ?? {}) as Record<string, FieldState>,
  ).pipe(owned("view/fields"));
  const evidence = Atom.make((get) => {
    const value = get(familyDoc)?.evidence;
    if (!value) return null;
    const sessions = get(sessionsResult);
    const session = AsyncResult.isSuccess(sessions)
      ? scopeSession(deps.scope.scope, sessions.value.value)
      : null;
    if (!session) return null;
    return here(value, documentAddress(session)) as EvidenceSlice | null;
  }).pipe(owned("view/evidence"));
  const reconciliation = Atom.make((get) => ({
    plan: get(familyDoc)?.plan,
    apply: get(familyDoc)?.apply,
  })).pipe(owned("view/reconciliation"));
  const lane = Atom.make((get) =>
    familyLane(get(snapshot), get(evidence), deps.source === "fixture"),
  ).pipe(owned("view/lane"));
  const saved = Atom.make((get) => savedFrom(initialDraft(get(lane).world))).pipe(
    owned("view/saved"),
  );

  const draft = Atom.make(initialDraft(registry.get(lane).world)).pipe(owned("page/draft"));
  const overlay = Atom.make<Overlay>("draft").pipe(owned("page/overlay"));
  const tableState = Atom.make(table()).pipe(owned("page/table"));
  const drillState = Atom.make(table()).pipe(owned("page/drill"));
  const docMode = Atom.make<"text" | "sheet">("text").pipe(owned("page/doc-mode"));
  const docZoom = Atom.make(1).pipe(owned("page/doc-zoom"));
  const drillType = Atom.make<string | null>(null).pipe(owned("page/drill-type"));
  const stageType = Atom.make(
    registry.get(lane).world.typeNames[1] ?? registry.get(lane).world.typeNames[0] ?? "Standard",
  ).pipe(owned("page/stage-type"));
  const focus = Atom.make<Focus>(null).pipe(owned("page/focus"));
  const focusedProposal = Atom.make<string | null>(null).pipe(owned("page/focused-proposal"));
  const pinnedParam = Atom.make<string | null>(null).pipe(owned("page/pinned-param"));
  const anatomyCollapsed = Atom.make(false).pipe(owned("page/anatomy-collapsed"));
  const inspect = Atom.make<Inspect>(null).pipe(owned("page/inspect"));
  const binding = Atom.make<Binding>(null).pipe(owned("page/binding"));
  const picker = Atom.make<{ open: string | null; level: string | null; query: string }>({
    open: null,
    level: null,
    query: "",
  }).pipe(owned("page/picker"));
  const seededRef = Atom.make(registry.get(lane).seedKey).pipe(Atom.autoDispose);
  const evidenceRef = Atom.make(registry.get(evidence)?.reading.observedAt ?? null).pipe(
    Atom.autoDispose,
  );
  const armedBuild = Atom.make<ArmedBuild>(null).pipe(owned("page/armed"));

  const profileSource = runtime.atom(() =>
    hostRead([registry.get(target)], () => deps.host.profile(registry.get(target))),
  );
  const profileResult = runtimeFactory
    .withReactivity(["profile"])(
      Atom.swr(profileSource, { staleTime: "60 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const profileFeed = Atom.make((get) =>
    feed(get(profileResult), (paths) => paths.map((path) => ({ id: path, label: path })), "read"),
  ).pipe(owned("feed/profile"));

  const set = <A>(verb: string, atom: Atom.Writable<A>, next: Setter<A>) =>
    write(verb, atom.label?.[0] ?? "page", () =>
      registry.update(atom, (previous) =>
        typeof next === "function" ? (next as (value: A) => A)(previous) : next,
      ),
    );
  const resetFor = (nextLane: ReturnType<typeof familyLane>) =>
    write("system", "slice-reset", () =>
      Atom.batch(() => {
        registry.set(seededRef, nextLane.seedKey);
        registry.set(draft, initialDraft(nextLane.world));
        registry.set(stageType, nextLane.world.typeNames[1] ?? nextLane.world.typeNames[0] ?? "");
        registry.set(drillType, null);
        registry.set(inspect, null);
        registry.set(binding, null);
        registry.set(focus, null);
        registry.set(focusedProposal, null);
        registry.set(pinnedParam, null);
        registry.set(overlay, "draft");
      }),
    );
  const unsubscribeLane = registry.subscribe(
    lane,
    (next) => {
      if (registry.get(seededRef) !== next.seedKey) resetFor(next);
      const stamp = registry.get(evidence)?.reading.observedAt ?? null;
      if (registry.get(evidenceRef) !== stamp)
        write("system", "evidence-refresh", () =>
          Atom.batch(() => {
            registry.set(evidenceRef, stamp);
            registry.update(draft, (previous) => ({
              ...previous,
              live: structuredClone(next.world.live?.values ?? {}),
            }));
          }),
        );
    },
    { immediate: true },
  );

  const buildFacts = Atom.make((get): BuildFacts => {
    const current = get(lane);
    return {
      relativePath: current.document?.relativePath ?? null,
      versionToken: current.document?.versionToken ?? null,
      validation: current.document ? (get(snapshot)?.validation ?? null) : null,
      unsavedCount: current.document
        ? draftToPatches(current.document.model, get(draft), initialDraft(current.world)).length
        : 0,
      stagedCount: Object.values(get(fields)).filter((field) => field.staged != null).length,
      boundTarget: get(target),
      armedToken: get(armedBuild)?.token ?? null,
    };
  }).pipe(owned("view/build-facts"));
  const buildRefusal = () => {
    const refusals = buildRefusals(registry.get(buildFacts));
    return refusals.length
      ? refusals.map((refusal) => refusal.says).join(" · ")
      : registry.get(armedBuild) == null
        ? "arm build .rfa in the sheet pane first"
        : null;
  };
  type CommandName = "open" | "save" | "capture" | "build" | "plan" | "apply";
  const keys: Record<CommandName, readonly string[]> = {
    plan: ["family"],
    apply: ["family"],
    open: ["settings"],
    save: ["settings"],
    capture: ["family"],
    build: ["family"],
  };
  const writer = {
    async command(name: CommandName, input: unknown) {
      if (name === "plan" || name === "apply") {
        const current = registry.get(lane);
        if (current.fixture || !current.document)
          refuse("Open a saved family JSON and bind a family document first.");
        if (registry.get(buildFacts).unsavedCount || registry.get(buildFacts).stagedCount)
          refuse("Save authored edits before planning or applying.");
        const result = expectRouteWrite(
          await writers.familyCommand(
            name,
            name === "plan"
              ? { documentId: { ...FAMILY_MODULE, relativePath: current.document!.relativePath } }
              : { expectedPlanHash: registry.get(reconciliation).plan?.entry.planHash ?? "" },
          ),
        );
        return name === "plan"
          ? "Review the current-family plan before applying."
          : JSON.stringify(result.result);
      }
      if (name === "open") {
        expectRouteWrite(await writers.settingsCommand("open", input as Record<string, unknown>));
        return "opened";
      }
      if (name === "capture") {
        expectRouteWrite(
          await writers.familyCommand(
            "capture_evidence",
            input as Record<string, unknown> | undefined,
          ),
        );
        return "capture";
      }
      if (name === "save") {
        const current = registry.get(lane);
        if (!current.document) {
          if (!current.fixture) refuse("Open a family document before saving.");
          write("save", "page/draft", () =>
            registry.update(draft, (value) => ({ ...value, dirty: false })),
          );
          return `saved ${current.world.path}`;
        }
        const patches = draftToPatches(
          current.document.model,
          registry.get(draft),
          initialDraft(current.world),
        );
        if (!patches.length)
          return `Nothing to write - every value already matches ${current.document.relativePath}.`;
        expectRouteWrite(await writers.settingsApply(patches));
        expectRouteWrite(await writers.settingsCommand("save"));
        return `saved ${current.document.relativePath} - ${patches.length} field${patches.length === 1 ? "" : "s"} written`;
      }
      const refusal = buildRefusal();
      if (refusal) refuse(refusal);
      const current = registry.get(lane).document!;
      const result = expectRouteWrite(
        await writers.familyCommand("build_evidence", {
          documentId: { ...FAMILY_MODULE, relativePath: current.relativePath },
        }),
      );
      const receipt = readBuildReceipt(result.result);
      if (receipt == null) return BUILD_OUTCOME_UNKNOWN;
      write("build", "page/armed", () => registry.set(armedBuild, null));
      return `built ${receipt.rfaPath}${receipt.converged == null ? "" : receipt.converged ? " — converged" : ` — ${receipt.residueCount ?? "unknown"} changes remain`}`;
    },
  };
  const commandVerb = (name: CommandName, input: () => unknown = () => undefined) => ({
    run: () => core.runVerb(name, () => writer.command(name, input()), keys[name]),
    refuse: name === "build" ? buildRefusal : () => null,
  });
  const verbs = {
    plan: commandVerb("plan"),
    apply: commandVerb("apply"),
    save: commandVerb("save"),
    capture: commandVerb("capture"),
    build: commandVerb("build"),
  };
  const buildOutcome = Atom.make((get): BuildRefusal | null => {
    const failure = get(core.failure);
    if (failure?.verb === "build") return { code: "host", says: failure.message };
    const receipt = get(core.receipt);
    return receipt?.verb === "build" && receipt.text === BUILD_OUTCOME_UNKNOWN
      ? { code: "unknown", says: BUILD_OUTCOME_UNKNOWN }
      : null;
  }).pipe(owned("view/build-outcome"));
  const setArmed = (next: ArmedBuild) =>
    write("arm-build", "page/armed", () =>
      Atom.batch(() => {
        registry.set(armedBuild, next);
        if (registry.get(core.receipt)?.verb === "build") registry.set(core.receipt, null);
      }),
    );
  const actions = {
    setDraft: (value: Setter<Draft>) => set("set-draft", draft, value),
    setOverlay: (value: Setter<Overlay>) => set("set-overlay", overlay, value),
    setTable: (value: Setter<MasterTableState>) => set("set-table", tableState, value),
    setDrill: (value: Setter<MasterTableState>) => set("set-drill", drillState, value),
    setDocMode: (value: Setter<"text" | "sheet">) => set("set-doc-mode", docMode, value),
    setDocZoom: (value: Setter<number>) => set("set-doc-zoom", docZoom, value),
    setDrillType: (value: Setter<string | null>) => set("set-drill-type", drillType, value),
    setStageType: (value: Setter<string>) => set("set-stage-type", stageType, value),
    setFocus: (value: Setter<Focus>) => set("set-focus", focus, value),
    setFocusedProposal: (value: Setter<string | null>) =>
      set("set-focused-proposal", focusedProposal, value),
    setPinnedParam: (value: Setter<string | null>) => set("set-pinned-param", pinnedParam, value),
    setAnatomyCollapsed: (value: Setter<boolean>) =>
      set("set-anatomy-collapsed", anatomyCollapsed, value),
    setInspect: (value: Setter<Inspect>) => set("set-inspect", inspect, value),
    setBinding: (value: Setter<Binding>) => set("set-binding", binding, value),
    armBuild: () =>
      setArmed({ token: registry.get(lane).document?.versionToken ?? null, reason: "" }),
    cancelBuild: () => setArmed(null),
    setBuildReason: (reason: string) =>
      set("build-reason", armedBuild, (previous) =>
        previous == null ? previous : { ...previous, reason },
      ),
    setPicker(value: Setter<{ open: string | null; level: string | null; query: string }>) {
      set("set-picker", picker, value);
    },
    say(text: string) {
      write("say", "verb/receipt", () =>
        registry.set(core.receipt, { verb: "page", text, at: Date.now() }),
      );
    },
    async openShared(
      documentId: NonNullable<FamilySnapshot["dependencies"]>[number]["documentId"],
    ) {
      if (
        registry.get(buildFacts).unsavedCount ||
        Object.values(registry.get(fields)).some((field) => field.staged || field.proposal)
      )
        throw new Error(
          "Save or resolve the current authored edits before opening a shared fragment.",
        );
      expectRouteWrite(await writers.settingsCommand("open", { documentId }));
    },
    save: verbs.save.run!,
    open(relativePath: string) {
      return runVerb(
        "open",
        async () => {
          expectRouteWrite(
            await writers.familyApply([
              {
                path: ["bindings", "profile"],
                value: { id: relativePath, label: relativePath },
              },
            ]),
          );
          return writer.command("open", { documentId: { ...FAMILY_MODULE, relativePath } });
        },
        keys.open,
      );
    },
    capture: verbs.capture.run!,
    build: verbs.build.run!,
    bind(nextTarget: string) {
      if (deps.source === "fixture")
        return Promise.reject(new Error("fixture family writes are disabled"));
      return runVerb(
        "bind",
        async () => {
          // ponytail: the world lives in the page Scope (`?target`); owed: family route navigation.
          return `bound ${nextTarget}`;
        },
        ["family", "profile"],
      );
    },
    setStage(stage: "author" | "evidence") {
      return writers.familyApply([{ path: ["stage"], value: stage }]);
    },
  };
  return {
    registry,
    atoms: {
      reconciliation,
      target,
      profile,
      routeStage,
      lane,
      snapshot,
      saved,
      draft,
      overlay,
      table: tableState,
      drill: drillState,
      docMode,
      docZoom,
      drillType,
      stageType,
      focus,
      focusedProposal,
      pinnedParam,
      anatomyCollapsed,
      inspect,
      binding,
      picker,
      armedBuild,
      buildFacts,
      buildOutcome,
      ...core.verbAtoms,
    },
    feeds: { profile: profileFeed },
    verbs,
    commandVerb,
    actions,
    dispose() {
      unsubscribeLane();
      core.dispose();
    },
  };
}
export type FamilyStore = ReturnType<typeof createFamilyStore>;
