import * as Atom from "effect/unstable/reactivity/Atom";
import { RegistryContext } from "@effect/atom-react";
import { elementKey, type SubjectKey } from "@pe/kit/lang/attention";
/**
 * /ducts: the Situation over one document's duct networks, and the one shell under it (E2): the
 * system tree over the loss Rules, the drawing, the inbox. The sentence names the document, the
 * subject system (a Revit system name, read across every group it is in) and the level. The page
 * is the manifest's `url` keys, so a link lands on the same
 * place. The snapshot is one `ducts.snapshot` read keyed on the target, the edit parameter slots
 * and `page.epoch`; targeting a document reads it again with no press, choosing a system does not.
 * The ASHRAE tables are always read; the snapshot, tables and catalogs are provided to the verbs so
 * `preview` and `apply` build their request from what is drawn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stagedDucts, type DuctClaim, type CellLike } from "@pe/agent-contracts";
import type { Reading, OrbitViewport, DuctsSnapshotSelector } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";

import { Surface } from "@pe/kit/lang/surface";
import { useWork } from "@pe/kit/lang/work";
import { frozenDemo } from "#/host/demo-client";
import {
  SAVED,
  useDuctSnapshot,
  useDuctTables,
  useDuctCatalogs,
  useSystemsSnapshot,
} from "./host";
import { SCENE_CLAIMS, SCENE_FIXTURE } from "./scene.fixture";
import { NAVIGATION_FIXTURE } from "./navigation.fixture";
import { COLOURS_FIXTURE } from "./colours.fixture";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { bindDuctsManifest, reconcileDuctsMembers, type LoadedDuctsReading } from "./manifest";
import { pendingCount, WRITTEN } from "@pe/ducts-domain/staged";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { usePricing } from "./use-pricing";
import type { PricingInput } from "./pricing-job";
import { worstRun } from "@pe/ducts-domain/losses";
import { scopeOf, systemScope, systemsOf } from "@pe/ducts-domain/system-scope";
import { activeSystem, toggleSystem } from "./selection";
import { verdictPatches } from "./claims";
import { claimsOf, type Claim } from "./legs";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { provisionalWords } from "./provisional";
import type { ProtoProps } from "./proto/props";
import { EScreen } from "./proto/e/screen";
import { SheetScreen } from "./sheet/mount";
import { useDuctsViewBridge } from "./view-bridge";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import type { ActionHandle } from "#/route/handle";

/** Panes read action state; an invocation always uses the route's latest admitted snapshot. */
function useBodyAction(action: ActionHandle): ActionHandle {
  const latest = useRef(action);
  latest.current = action;
  const { label, says, needs, effect, chord, refusal, stage, count } = action;
  return useMemo(
    () => ({
      label,
      says,
      needs,
      effect,
      chord,
      refusal,
      stage,
      count,
      run: (input) => latest.current.run(input),
    }),
    [label, says, needs, effect, chord, refusal, stage, count],
  );
}

const NO_SLOTS = {};
const ROSTER: DuctsSnapshotSelector = { kind: "roster" };

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(4));
const NO_NATIVE_OBSERVATION: NativeObservation = { scope: null };

/** A system's picker line: classification, the tags of the units rooting it, terminals, networks. */
const systemSub = (item: ReturnType<typeof systemsOf>[number]) =>
  [
    item.classification,
    item.units.join(", ") || "no fan",
    `${item.terminals} terminal${item.terminals === 1 ? "" : "s"}`,
    item.groups.length > 1 ? `${item.groups.length} networks` : "",
  ]
    .filter(Boolean)
    .join(" · ");

/** Revit's critical path as a word, whatever the engine flag: a system with no path reads "no path". */
const revitSays = (inWg: number | null | undefined) => (inWg == null ? "no path" : fmt(inWg));

/** `url` is false in a chat pane, which does not own the address. Stage `sheet` swaps the E2 body
 * for the fan sheet under the same shell (`sheet/mount.tsx`). */
export function DuctsRoute({ url = true }: { url?: boolean } = {}) {
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  // `?demo=scene` mounts the makeup-air fixture, snapshot included, and no host is read; its
  // subject and claims have the edit cells' shapes, and a verdict press stays in this page.
  const demoName = useMemo(frozenDemo, []);
  const demo =
    demoName === "navigation"
      ? NAVIGATION_FIXTURE
      : demoName === "colours"
        ? COLOURS_FIXTURE
        : demoName === "scene"
          ? SCENE_FIXTURE
          : null;
  const [demoClaims, setDemoClaims] = useState<Record<string, DuctClaim>>(
    () => demo?.claims ?? SCENE_CLAIMS,
  );
  const loadedReading = useRef<LoadedDuctsReading | null>(null);
  const shownPose = useRef<OrbitViewport | null>(null);
  const manifest = useMemo(() => {
    const bound = bindDuctsManifest(
      () => loadedReading.current,
      () => shownPose.current,
    );
    if (demoName !== "navigation" && demoName !== "colours") return bound;
    return {
      ...bound,
      // A fixture has no document authority, even with a real target/thread carried in the URL.
      needs: undefined,
      actions: {
        ...bound.actions!,
        refresh: {
          ...bound.actions!.refresh,
          does: undefined,
          needs: "host" as const,

          says: "Recalculate the fixture in the pricing worker; no Revit read or write",
        },
      },
    };
  }, [demoName]);
  // The snapshot and tables are read below, once the target resolves; the verbs see them here.
  const [provided, setProvided] = useState<
    Record<"ducts" | "tables" | "catalogs" | "pricing", Reading<unknown>>
  >({
    ducts: { state: "absent" },
    tables: { state: "absent" },
    catalogs: { state: "absent" },
    pricing: { state: "absent" },
  });
  const handle = useRoute(manifest, { target: chosen, thread, provided, url });
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const documentKey = doc ? `${doc.session}/${doc.openId}` : null;
  const edit = useMemo(() => stagedDucts(handle.work.doc), [handle.work.doc]);
  // The whole-document read outgrew the bridge's 16 MiB frame on cloud Chadds (2026-10-29), so no
  // stage asks it: the fan sheet reads what its open fan touches (`sheet/mount.tsx`), and the
  // network stage reads the systems the person opened (kaitpw 2026-10-29). The roster names every
  // system cheaply; "read every system" reads the rest a few at a time (`system-reads.ts`). A
  // saved snapshot is still the one whole read.
  const scopedDoc = demo || SAVED || page.stage === "sheet" ? null : doc;
  const roster = useDuctSnapshot(scopedDoc, page.epoch, NO_SLOTS, null, ROSTER);
  const rosterSystems = roster.snapshot?.systems ?? null;
  const [everyFor, setEveryFor] = useState<string | null>(null);
  const every = everyFor !== null && everyFor === documentKey;
  const wanted = useMemo(() => {
    const ids = new Map<string, number[]>();
    for (const s of rosterSystems ?? []) ids.set(s.name, [...(ids.get(s.name) ?? []), s.id]);
    return [
      ...page.system.flatMap((name) => ids.get(name) ?? []),
      ...(every ? (rosterSystems ?? []).map((s) => s.id) : []),
    ];
  }, [rosterSystems, page.system, every]);
  const scoped = useSystemsSnapshot(
    scopedDoc,
    page.epoch,
    edit.parameters,
    edit.labelParameter,
    wanted,
  );
  const whole = useDuctSnapshot(
    SAVED && !demo && page.stage !== "sheet" ? doc : null,
    page.epoch,
    edit.parameters,
    edit.labelParameter,
  );
  const read = SAVED ? whole : scoped;
  // How much of the document the panes hold; null when they hold all of it (saved, fixture).
  const coverage = useMemo<ProtoProps["coverage"]>(() => {
    if (!scopedDoc || !rosterSystems) return null;
    const done = rosterSystems.filter((s) => scoped.read.has(s.id)).length;
    return {
      read: done,
      of: rosterSystems.length,
      reading: rosterSystems.filter((s) => scoped.reading.includes(s.id)).map((s) => s.name),
      readAll:
        every || done === rosterSystems.length ? null : () => setEveryFor(documentKey),
    };
  }, [scopedDoc, rosterSystems, scoped.read, scoped.reading, every, documentKey]);
  const snapshot = demo?.snapshot ?? read.snapshot;
  const snapshotCurrent = demo !== null || read.current;
  // useDuctSnapshot fences responses by the exact request generation before exposing data.
  const nativeObservation = useMemo<NativeObservation>(
    () => ({
      scope: {
        document: demo || SAVED ? null : (read.nativeObservation?.document ?? null),
        source: demo ? "fixture" : SAVED ? "saved" : "native",
      },
      references: [...(snapshot?.nodes ?? []), ...(snapshot?.segments ?? [])].map((element) => ({
        elementId: element.id,
        uniqueId: element.uniqueId,
      })),
    }),
    [snapshot, read.nativeObservation, demo],
  );
  const error = demo ? null : (read.error ?? (scopedDoc ? roster.error : null));
  const pending = demo ? false : read.pending;
  const catalogs = useDuctCatalogs(page.epoch);
  const tables = useDuctTables(demo ? null : (doc?.session ?? null));
  const grids =
    demoName === "colours"
      ? COLOURS_FIXTURE.grids
      : demoName === "navigation"
        ? NAVIGATION_FIXTURE.grids
        : tables.grids;
  const catalogTables =
    demoName === "navigation" || demoName === "colours" ? EMPTY_CATALOGS : catalogs.tables;
  // The system's groups (Work's subject cells and claims key on group ids, never shown).
  const systemGroups = useMemo(
    () => (snapshot ? (scopeOf(snapshot, page.system)?.groups ?? []) : []),
    [snapshot, page.system],
  );
  // The subject scene is the person's edit subject, else Pea's suggestion, of the system's first
  // group that has one; null until one exists.
  const subjectIds = demo
    ? demo.subject
    : systemGroups
        .map((g) => edit.subject[g] ?? handle.work.doc?.subject?.[g]?.suggestion?.value)
        .find((ids) => ids != null);
  const onVerdict = useCallback(
    (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => {
      if (demo) {
        setDemoClaims((prev) => ({ ...prev, [claim.id]: { ...prev[claim.id]!, verdict } }));
        return;
      }
      void handle.work.write(verdictPatches(handle.work.doc, claim, verdict));
    },
    [demo, handle.work.doc, handle.work.write],
  );
  // Claims live beside the subject, not inside it: a chosen system shows only the claims that name
  // its groups' elements (claimsForGroup), so one system's claims never ride onto another.
  const claimCells = useMemo(
    () =>
      demo
        ? demoClaims
        : Object.fromEntries(
            Object.entries(handle.work.doc?.claims ?? {}).flatMap(([id, cell]) => {
              const value = cell.edit?.value ?? cell.suggestion?.value;
              return value ? [[id, value] as const] : [];
            }),
          ),
    [demo, demoClaims, handle.work.doc],
  );
  const claims = useMemo(() => {
    const scope = snapshot && scopeOf(snapshot, page.system);
    if (!scope) return claimsOf(claimCells);
    return claimsOf(claimsForGroup(claimCells, [...scope.members]));
  }, [claimCells, page.system, snapshot]);
  const subject = useMemo(
    () =>
      subjectIds
        ? { ids: subjectIds, claims, work: demo ? null : handle.work.doc, onVerdict }
        : null,
    [demo, subjectIds, claims, handle.work.doc, onVerdict],
  );
  const pricingInput = useMemo<PricingInput | null>(
    () =>
      // Not gated on `pending`: the systems read is current while it reads one more system, and
      // the panes price what is read so far (the whole read is never current while pending).
      snapshot && snapshotCurrent && grids && !error
        ? {
            snapshot,
            grids,
            catalogs: catalogTables,
            doc: handle.work.doc,
            revision: handle.work.revision,
            epoch: page.epoch,
            documentKey,
          }
        : null,
    [
      snapshot,
      snapshotCurrent,
      grids,
      catalogTables,
      error,
      handle.work.doc,
      handle.work.revision,
      page.epoch,
      documentKey,
    ],
  );
  const pricingState = usePricing(pricingInput);
  // Pricing runs in a worker, not a reading hook, so the route registers it once for every pane.
  useWork(pricingState.running, "pricing…");
  const priced = pricingState.observation?.result.priced ?? null;
  useEffect(() => {
    setProvided({
      pricing: pricingState.observation
        ? { state: "ready", observation: pricingState.observation }
        : { state: "absent" },
      catalogs: { state: "ready", observation: catalogTables },
      ducts: snapshot
        ? snapshotCurrent
          ? { state: "ready", observation: snapshot }
          : error
            ? { state: "failed", previous: snapshot, message: error }
            : { state: "stale", previous: snapshot, reason: read.staleReason }
        : { state: "absent" },
      tables: grids ? { state: "ready", observation: grids } : { state: "absent" },
    });
  }, [
    snapshot,
    snapshotCurrent,
    error,
    read.staleReason,
    grids,
    catalogTables,
    pricingState.observation,
  ]);
  const reading = useMemo<LoadedDuctsReading | null>(
    () =>
      snapshot && snapshotCurrent
        ? { snapshot, drawn: priced?.snapshot ?? null, claims: claimCells }
        : null,
    [snapshot, snapshotCurrent, priced?.snapshot, claimCells],
  );
  loadedReading.current = reading;
  // A camera write cannot change system membership; do not rebuild its evidence for each pose.
  const reconciled = useMemo(
    () => reconcileDuctsMembers(page, reading),
    [page.system, page.selected, reading],
  );
  const membersReady = reading?.drawn != null && Object.keys(reconciled).length === 0;
  const reconciledPage = useRef<object | null>(null);
  useEffect(() => {
    if (reading && Object.keys(reconciled).length > 0 && reconciledPage.current !== page) {
      reconciledPage.current = page;
      setPage(reconcileDuctsMembers(page, reading), { history: "replace" });
    }
  }, [reading, page, membersReady, setPage]);
  // A re-read prices its new snapshot behind the last priced one: the screen keeps drawing what it
  // has, marked refreshing, instead of blanking to "pricing…". Never across documents.
  const lastPriced = useRef<{
    key: string | null;
    snapshot: DuctSnapshot;
    priced: NonNullable<typeof priced>;
    analysis: NonNullable<typeof pricingState.observation>["result"]["analysis"];
  } | null>(null);
  if (snapshot && priced)
    lastPriced.current = {
      key: documentKey,
      snapshot,
      priced,
      analysis: pricingState.observation!.result.analysis,
    };
  const held =
    !priced && lastPriced.current?.key === documentKey && (pending || !!snapshot)
      ? lastPriced.current
      : null;
  const pricing = !!snapshot && !!grids && !priced && !held && !pricingState.error;
  // The Work every pane reads: the model's stored rulings under the person's pending ones.
  const seen = useMemo(
    () => withStoredRulings(handle.work.doc, snapshot?.store),
    [handle.work.doc, snapshot],
  );

  const ready = pricingState.observation?.result.ready ?? {};
  const groups = snapshot?.groups ?? [];
  const levels = snapshot?.levels ?? [];
  const reportPose = useDuctsViewBridge({
    thread: thread ?? undefined,
    url,
    page,
    setPage,
    document: doc,
    reading,
    membersReady,
  });
  const systems = useMemo(() => (snapshot ? systemsOf(snapshot) : []), [snapshot]);
  // The header's fan static is one system's: the active one.
  const system = systems.find((item) => item.name === activeSystem(page)) ?? null;
  const level = levels.find((item) => String(item.id) === page.level) ?? null;
  const readWord =
    !doc && !SAVED && !demo
      ? "choose a document first"
      : error
        ? `ducts.snapshot failed: ${error}`
        : pending || roster.pending
          ? "reading ducts…"
          : "this document has no duct networks";
  const busy = handle.busy !== null;
  // The system's fan static: its worst fan's, over the runs that price its terminals in every group
  // it is in (a shared group's other runs are other systems'), as edit (`next`, the solve the
  // sidebar reads); Revit's own critical path beside it.
  const solved = useMemo(() => {
    if (!system || !priced) return null;
    const scope = systemScope(priced.snapshot, system.name);
    const paths = [...scope.terminals].flatMap((t) => priced.next.paths[t] ?? []);
    const worst = worstRun(priced.next, scope.groups, scope.terminals);
    return {
      // A group with an implausible row has no price: no fan static, never a partial sum.
      blocked: scope.groups.some((g) =>
        priced.next.byGroup[g]?.implausible.some((id) => scope.prices.has(id)),
      ),
      fan: scope.groups.some((g) =>
        priced.next.byGroup[g]?.implausible.some((id) => scope.prices.has(id)),
      )
        ? null
        : (worst?.total ?? null),
      provisional: paths.find((p) => p.provisional)?.provisional ?? null,
      fanless: groups.filter((g) => scope.pricing.has(g.id)).every((g) => !g.rootIds.length),
      revitCritical:
        snapshot?.systems.find((s) => s.name === system.name)?.criticalPathLossInWg ?? null,
    };
  }, [system, priced, groups, snapshot]);
  // With the network engine on, ducts.snapshot takes about 30 s on a large model: say so.
  const readingWord = snapshot?.document.networkBasedCalculations
    ? "reading ducts.snapshot (about 30 s with network-based calculations on)"
    : "reading ducts.snapshot";
  const lossesWord = pricingState.error
    ? `pricing failed: ${pricingState.error}`
    : held
      ? "refreshing pricing; the bars show the last priced Work revision"
      : !snapshot
        ? coverage && !wanted.length
          ? "choose a system to read its ducts"
          : readingWord
        : pending
          ? coverage
            ? `reading ${coverage.reading.join(", ")}; the bars show what is read`
            : `${readingWord}; the bars show the last read`
          : tables.error
            ? `ducts.tables failed: ${tables.error}`
            : !grids
              ? "reading the ASHRAE tables"
              : !priced
                ? "pricing…"
                : solved?.fanless
                  ? "no air mover; priced from the open end"
                  : solved?.blocked
                    ? "needs a fix: implausible loss (no Pe fan; nothing is written to Revit for it)"
                    : solved
                      ? `Pe fan ${fmt(solved.fan)} in-wg${provisionalWords(solved.provisional)} (not in Revit until written), Revit ${revitSays(solved.revitCritical)}`
                      : `largest Pe fan ${fmt(priced.next.fan)} in-wg${provisionalWords(priced.next.provisional)} over ${systems.length} systems${coverage && coverage.read < coverage.of ? ` (${coverage.read} of ${coverage.of} read)` : ""}`;
  // Every written segment's cells count in the Work sentence.
  const counted = useMemo(
    () =>
      Object.fromEntries(
        WRITTEN.flatMap((segment) =>
          Object.entries(handle.work.doc?.[segment] ?? {}).map(
            ([key, cell]) => [`${segment}:${key}`, cell as CellLike] as const,
          ),
        ),
      ),
    [handle.work.doc],
  );

  const sentence = (
    <>
      on{" "}
      {demoName === "navigation" || demoName === "colours" ? (
        demo!.snapshot.document.title
      ) : SAVED ? (
        "saved snapshot"
      ) : (
        <LadderPicker ladder={ladder} disabled={busy} />
      )}
      {page.stage === "sheet" ? (
        // The fan sheet scopes by fan, not by system or level; its fans list is the subject.
        "."
      ) : (
        <>
          {", "}
          <Ladder
            levels={[
              {
                key: "system",
                label:
                  page.system.length > 1
                    ? page.system.join(" + ")
                    : system
                      ? system.classification
                        ? `${system.name} (${system.classification})`
                        : system.name
                      : null,
                placeholder:
                  coverage && coverage.read < coverage.of ? "choose a system" : "every system",
                // A system by its name, classification and the tags of the units rooting it; never a
                // group id. Read scoped, the roster names every system and one not read says so.
                options: coverage
                  ? rosterSystems!.map((item) => {
                      const read = systems.find((s) => s.name === item.name);
                      return {
                        id: item.name,
                        label: item.name,
                        sub: read ? systemSub(read) : `${item.classification} · not read yet`,
                      };
                    })
                  : snapshot
                    ? systems.map((item) => ({
                        id: item.name,
                        label: item.name,
                        sub: systemSub(item),
                      }))
                    : null,
                note: readWord,
                picked: (id) => page.system.includes(id),
                pick: (id) => setPage({ system: toggleSystem(page.system, id) }),
              },
            ]}
            disabled={busy}
          />
          {" on "}
          <Ladder
            levels={[
              {
                key: "level",
                label: level?.name ?? null,
                placeholder: "every level",
                options: snapshot
                  ? levels.map((item) => ({ id: String(item.id), label: item.name }))
                  : null,
                note: readWord,
                picked: (id) => id === page.level,
                pick: (id) => setPage({ level: id === page.level ? "" : id }),
              },
            ]}
            disabled={busy}
          />
          {"; "}
          {lossesWord}.
        </>
      )}
    </>
  );

  // Stable between renders so the memoized panes hold.
  const preview = page.evaluation?.response ?? null;
  const work = useMemo(
    () => ({
      doc: seen,
      revision: handle.work.revision,
      write: handle.work.write,
      preview,
    }),
    [seen, handle.work.revision, handle.work.write, preview],
  );
  const empty =
    !doc && !SAVED && !demo
      ? { says: "no document bound", exit: "choose a document in the sentence" }
      : error && !snapshot
        ? { says: `ducts.snapshot failed: ${error}`, exit: "refresh once the host answers" }
        : !snapshot && coverage && !wanted.length
          ? {
              says: `${coverage.of} systems; none read yet`,
              exit: "choose a system in the sentence to read its ducts, or read every system a few at a time",
            }
          : !snapshot
            ? { says: "reading ducts…", exit: "wait for the snapshot" }
            : null;

  const onSelect = useCallback(
    (id: number | null) => setPage({ selected: id == null ? "" : String(id), issue: "" }),
    [setPage],
  );
  const onSelectClaim = useCallback(
    (claim: Claim) => setPage({ selected: claim.id, issue: "" }),
    [setPage],
  );
  const previewAction = useBodyAction(handle.actions.preview);
  const applyAction = useBodyAction(handle.actions.apply);
  const healPreviewAction = useBodyAction(handle.actions["heal-preview"]);
  const healAction = useBodyAction(handle.actions.heal);
  const fanPreviewAction = useBodyAction(handle.actions["fan-preview"]);
  const fanAction = useBodyAction(handle.actions.fan);
  const actions = useMemo(
    () => ({
      preview: previewAction,
      apply: applyAction,
      healPreview: healPreviewAction,
      heal: healAction,
      fanPreview: fanPreviewAction,
      fan: fanAction,
      busy,
    }),
    [previewAction, applyAction, healPreviewAction, healAction, fanPreviewAction, fanAction, busy],
  );
  const attentionDoc =
    documentKey ?? `fixture:ducts:${demoName ?? snapshot?.document.title ?? "none"}`;
  const selection = useMemo(
    () =>
      Atom.make((get): ReadonlySet<SubjectKey> => {
        const page = get(handle.pageState).page;
        return new Set(
          page.selected && /^\d+$/.test(page.selected)
            ? [elementKey(page.selected)]
            : // A worksheet strand or section pick (sheet stage) selects the group as itself.
              page.selected && /^(run|section):/.test(page.selected)
              ? [page.selected as SubjectKey]
              : page.issue
              ? [`issue:${page.issue}` as SubjectKey]
              : [],
        );
      }),
    [handle.pageState],
  );
  const shell: ProtoProps = {
    attentionDoc,
    selection,
    snapshot: held?.snapshot ?? snapshot,
    priced: held?.priced ?? priced,
    pricing,
    findings: catalogs.findings,
    ready,
    analysis: pricingState.observation?.result.analysis ?? held?.analysis ?? null,
    subject,
    claims,
    onVerdict,
    claimCells: demoClaims,
    page,
    setPage,
    onPose: (pose) => {
      shownPose.current = pose;
      reportPose(pose);
    },
    onSelect,
    onSelectClaim,
    work,
    empty,
    doc,
    captureSource:
      snapshotCurrent && read.nativeObservation?.document && read.version
        ? { document: read.nativeObservation.document, version: read.version }
        : null,
    reading: {
      pending,
      error: error ?? pricingState.error ?? null,
      // A failed refresh is said, not still refreshing.
      refreshing: !error && !pricingState.error && (!!held || (!snapshotCurrent && !!snapshot)),
    },
    actions,
    edit: pendingCount(handle.work.doc, snapshot?.store),
    coverage,
  };

  return (
    <RegistryContext value={handle.registry}>
      <Surface
        head={
          <RouteShell
            manifest={manifest}
            handle={handle}
            situation={
              <Situation
                handle={handle}
                work={{
                  counted,
                  draw: (_summary, line) => (
                    <>
                      {catalogs.findings.map((finding) => (
                        <p key={finding} data-tone="caution">
                          {finding}
                        </p>
                      ))}
                      {line}
                    </>
                  ),
                }}
                target={{
                  session: ladder.sessionWord,
                  document:
                    demoName === "colours"
                      ? "firm colours fixture"
                      : demoName === "navigation"
                        ? "navigation fixture"
                        : SAVED
                          ? "saved snapshot"
                          : demo
                            ? "scene fixture"
                            : ladder.docWord,
                }}
                sentence={sentence}
                ledger={[
                  [
                    "read",
                    error
                      ? "failed"
                      : snapshot
                        ? `${snapshot.document.elapsedMs} ms`
                        : pending
                          ? "reading"
                          : "none",
                  ],
                  ["source", SAVED ? "saved" : demo ? "fixture" : "host"],
                ]}
              />
            }
          />
        }
      >
        <NativeObservationScope
          value={snapshotCurrent && !held ? nativeObservation : NO_NATIVE_OBSERVATION}
        >
          {page.stage === "sheet" ? (
            <SheetScreen props={shell} />
          ) : (
            <EScreen props={shell} />
          )}
        </NativeObservationScope>
      </Surface>
    </RegistryContext>
  );
}
