import { Layer } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import {
  familyRouteState,
  settingsRouteState,
  type FamilyDocument,
  type RouteStatePatch,
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
import { PROFILE_TERMINAL } from "#/family/product";
import { draftToPatches } from "#/family/project";
import { resolveTarget } from "#/host/target";
import {
  createRouteStoreCore,
  docAtom,
  hostRead,
  readingIsCurrent,
  type Scope,
  type Slice,
} from "#/state/route-store";
import type { Verb } from "#/targeting/model";

export interface SearchPort {
  readonly target: string;
  readonly profile: string;
  patch(partial: { target?: string }): void;
}
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
  registry: AtomRegistry.AtomRegistry;
  scope: Scope;
  host: FamilyHost;
  search: SearchPort;
  slices?: FamilySlices;
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
  const settingsDoc = Atom.make((get): SettingsRouteDocument | null => {
    const result = get(settingsSlice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const familyDoc = Atom.make((get): FamilyDocument | null => {
    const result = get(familySlice);
    return AsyncResult.isSuccess(result) ? result.value.doc : null;
  }).pipe(Atom.autoDispose);
  const sessionsSource = runtime.atom(() => hostRead(["sessions"], deps.host.sessions));
  const sessionsResult = runtimeFactory
    .withReactivity(["sessions"])(
      Atom.swr(sessionsSource, { staleTime: "5 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const snapshot = Atom.make((get) => {
    const doc = get(settingsDoc);
    const value = doc?.snapshot;
    if (
      !value ||
      value.from.settingsDocumentId.moduleKey !== FAMILY_MODULE.moduleKey ||
      value.from.settingsDocumentId.rootKey !== FAMILY_MODULE.rootKey ||
      (deps.search.profile && value.from.settingsDocumentId.relativePath !== deps.search.profile)
    )
      return null;
    const target = doc.binding.target;
    return target && readingIsCurrent(value.from, { target, documentId: target })
      ? (value as FamilySnapshot)
      : null;
  }).pipe(owned("view/snapshot"));
  const fields = Atom.make(
    (get) => (get(settingsDoc)?.fields ?? {}) as Record<string, FieldState>,
  ).pipe(owned("view/fields"));
  const evidence = Atom.make((get) => {
    const value = get(familyDoc)?.evidence;
    if (!value) return null;
    const sessions = get(sessionsResult);
    const resolution = AsyncResult.isSuccess(sessions)
      ? resolveTarget(sessions.value.value, deps.search.target)
      : null;
    if (resolution?.kind !== "resolved") return null;
    const target = resolution.session.sdkSessionId ?? `pid:${resolution.session.processId}`;
    if (value.from.origin === "build") {
      const documentId = get(snapshot)?.from.documentId;
      return documentId && readingIsCurrent(value.from, { target, documentId })
        ? (value as EvidenceSlice)
        : null;
    }
    if (!resolution.session.activeDocumentId) return null;
    return readingIsCurrent(value.from, {
      target,
      documentId: resolution.session.activeDocumentId,
    })
      ? (value as EvidenceSlice)
      : null;
  }).pipe(owned("view/evidence"));
  const lane = Atom.make((get) => familyLane(get(snapshot), get(evidence))).pipe(
    owned("view/lane"),
  );
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
  const evidenceRef = Atom.make(registry.get(evidence)?.from.observedAt ?? null).pipe(
    Atom.autoDispose,
  );
  const armedBuild = Atom.make<ArmedBuild>(null).pipe(owned("page/armed"));

  const profileSource = runtime.atom(() =>
    hostRead([deps.search.target], () => deps.host.profile(deps.search.target)),
  );
  const profileResult = runtimeFactory
    .withReactivity(["profile"])(
      Atom.swr(profileSource, { staleTime: "60 seconds", revalidateOnMount: false }),
    )
    .pipe(Atom.autoDispose);
  const profileFeed = Atom.make((get) =>
    PROFILE_TERMINAL.feed(
      get(profileResult),
      (paths) => paths.map((path) => ({ id: path, label: path })),
      "read",
    ),
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
      const stamp = registry.get(evidence)?.from.observedAt ?? null;
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

  const expect = <T extends { ok: boolean; error?: string; hint?: string }>(
    result: T,
    fallback: string,
  ): T => {
    if (!result.ok) throw Error(result.hint ?? result.error ?? fallback);
    return result;
  };
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
      boundTarget: deps.search.target,
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
  type CommandName = "open" | "save" | "capture" | "build";
  const keys: Record<CommandName, readonly string[]> = {
    open: ["settings"],
    save: ["settings"],
    capture: ["family"],
    build: ["family"],
  };
  const writer = {
    async command(name: CommandName, input: unknown) {
      if (name === "open") {
        expect(
          await deps.host.settingsCommand("open", input as Record<string, unknown>),
          "open failed",
        );
        return "opened";
      }
      if (name === "capture") {
        expect(
          await deps.host.familyCommand(
            "capture_evidence",
            input as Record<string, unknown> | undefined,
          ),
          "capture failed",
        );
        return "capture";
      }
      if (name === "save") {
        const current = registry.get(lane);
        if (!current.document) {
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
        expect(await deps.host.settingsApply(patches), "the document rejected it");
        expect(await deps.host.settingsCommand("save"), "save failed");
        return `saved ${current.document.relativePath} - ${patches.length} field${patches.length === 1 ? "" : "s"} written`;
      }
      const refusal = buildRefusal();
      if (refusal) throw Error(refusal);
      const current = registry.get(lane).document!;
      const result = expect(
        await deps.host.familyCommand("build_evidence", {
          documentId: { ...FAMILY_MODULE, relativePath: current.relativePath },
        }),
        "build failed",
      );
      const receipt = readBuildReceipt(result.result);
      if (receipt == null) return BUILD_OUTCOME_UNKNOWN;
      write("build", "page/armed", () => registry.set(armedBuild, null));
      return `built ${receipt.rfaPath}`;
    },
  };
  if (
    deps.search.profile &&
    registry.get(snapshot)?.from.settingsDocumentId.relativePath !== deps.search.profile
  )
    void write("system", "open", () =>
      writer.command("open", {
        documentId: { ...FAMILY_MODULE, relativePath: deps.search.profile },
      }),
    ).catch(() => undefined);
  const commandVerb = (
    name: CommandName,
    input: () => unknown = () => undefined,
  ): Pick<Verb, "run" | "refuse"> => ({
    run: () => core.runVerb(name, () => writer.command(name, input()), keys[name]),
    ...(name === "build" ? { refuse: buildRefusal } : {}),
  });
  const verbs = {
    save: commandVerb("save"),
    capture: commandVerb("capture"),
    build: commandVerb("build"),
  };
  const buildOutcome = Atom.make((get): BuildRefusal | null => {
    const failure = get(core.failure);
    if (failure?.kind === "host" && failure.verb === "build")
      return { code: "host", says: failure.message };
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
    save: verbs.save.run!,
    open(relativePath: string) {
      return commandVerb("open", () => ({ documentId: { ...FAMILY_MODULE, relativePath } })).run!();
    },
    capture: verbs.capture.run!,
    build: verbs.build.run!,
    bind(nextTarget: string) {
      return runVerb(
        "bind",
        async () => {
          const doc = registry.get(familyDoc);
          const sessions = registry.get(sessionsResult);
          const sessionItems = AsyncResult.isSuccess(sessions)
            ? sessions.value.value
            : await deps.host.sessions();
          const resolution = resolveTarget(sessionItems, nextTarget);
          const target =
            resolution?.kind === "resolved"
              ? (resolution.session.sdkSessionId ?? `pid:${resolution.session.processId}`)
              : null;
          const current =
            target && resolution?.kind === "resolved" && resolution.session.activeDocumentId
              ? { target, documentId: resolution.session.activeDocumentId }
              : null;
          const patches: RouteStatePatch[] = [
            {
              path: ["binding"],
              value: {
                target: nextTarget || null,
                boundAt: nextTarget ? new Date().toISOString() : null,
              },
            },
          ];
          const settingsDocumentId = registry.get(snapshot)?.from.documentId;
          const evidenceSource =
            doc?.evidence?.from.origin === "build"
              ? target && settingsDocumentId
                ? { target, documentId: settingsDocumentId }
                : null
              : current;
          if (
            doc?.evidence &&
            (!evidenceSource || !readingIsCurrent(doc.evidence.from, evidenceSource))
          )
            patches.push({ path: ["evidence"], value: null });
          expect(await deps.host.familyApply(patches), "bind failed");
          write("bind", "url/target", () => deps.search.patch({ target: nextTarget }));
          return `bound ${nextTarget}`;
        },
        ["family", "profile"],
      );
    },
  };
  return {
    registry,
    search: deps.search,
    slices: { settings: settingsSlice, family: familySlice },
    atoms: {
      lane,
      snapshot,
      fields,
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
      busy: core.busy,
      failure: core.failure,
      receipt: core.receipt,
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
