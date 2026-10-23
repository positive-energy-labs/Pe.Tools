/**
 * /ducts: the Situation over one document's duct networks, and the one shell under it (E2): the
 * system tree over the loss Rules, the drawing, the inbox. The sentence names the document, the
 * subject system (a Revit system name, read across every group it is in) and the level. The page
 * is the manifest's `url` keys, so a link lands on the same
 * place. The snapshot is one `ducts.snapshot` read keyed on the target, the staged parameter slots
 * and `page.epoch`; targeting a document reads it again with no press, choosing a system does not.
 * The ASHRAE tables are always read; the snapshot, tables and catalogs are provided to the verbs so
 * `preview` and `apply` build their request from what is drawn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { stagedDucts, type DuctClaim, type TrichotomyCellLike } from "@pe/agent-contracts";
import type { Reading } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";

import { Surface } from "#/components/lang/surface";
import { frozenDemo } from "#/host/demo-client";
import { SAVED, useDuctSnapshot, useDuctTables, useDuctCatalogs } from "./host";
import { SCENE_CLAIMS, SCENE_FIXTURE } from "./scene.fixture";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { bindDuctsManifest, reconcileDuctsMembers, type LoadedDuctsReading } from "./manifest";
import { pendingCount, WRITTEN } from "@pe/ducts-domain/staged";
import { withStoredRulings } from "@pe/ducts-domain/rulings";
import { price } from "@pe/ducts-domain/pricing";
import { worstRun } from "@pe/ducts-domain/losses";
import { systemScope, systemsOf } from "@pe/ducts-domain/system-scope";
import { readiness } from "@pe/ducts-domain/readiness";
import { verdictPatches } from "./claims";
import { claimsOf, type Claim } from "./legs";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { provisionalWords } from "./provisional";
import type { ProtoProps } from "./proto/props";
import { EScreen } from "./proto/e/screen";
import { useDuctsViewBridge } from "./view-bridge";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import type { ActionHandle } from "#/route/handle";

/** Panes read action state; an invocation always uses the route's latest admitted snapshot. */
function useBodyAction(action: ActionHandle): ActionHandle {
  const latest = useRef(action);
  latest.current = action;
  const { label, says, needs, actor, chord, refusal, stage, count } = action;
  return useMemo(
    () => ({
      label,
      says,
      needs,
      actor,
      chord,
      refusal,
      stage,
      count,
      run: (input) => latest.current.run(input),
    }),
    [label, says, needs, actor, chord, refusal, stage, count],
  );
}

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(4));

/** Revit's critical path as a word, whatever the engine flag: a system with no path reads "no path". */
const revitSays = (inWg: number | null | undefined) => (inWg == null ? "no path" : fmt(inWg));

/** `url` is false in a chat pane, which does not own the address. */
export function DuctsRoute({ url = true }: { url?: boolean } = {}) {
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  // `?demo=scene` mounts the makeup-air fixture, snapshot included, and no host is read; its
  // subject and claims have the staged cells' shapes, and a verdict press stays in this page.
  const demo = useMemo(() => (frozenDemo() === "scene" ? SCENE_FIXTURE : null), []);
  const [demoClaims, setDemoClaims] = useState<Record<string, DuctClaim>>(SCENE_CLAIMS);
  const loadedReading = useRef<LoadedDuctsReading | null>(null);
  const manifest = useMemo(() => bindDuctsManifest(() => loadedReading.current), []);
  // The snapshot and tables are read below, once the target resolves; the verbs see them here.
  const [provided, setProvided] = useState<
    Record<"ducts" | "tables" | "catalogs", Reading<unknown>>
  >({
    ducts: { state: "absent" },
    tables: { state: "absent" },
    catalogs: { state: "absent" },
  });
  const handle = useRoute(manifest, { target: chosen, thread, provided, url });
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const documentKey = doc ? `${doc.session}/${doc.openId}` : null;
  const staged = useMemo(() => stagedDucts(handle.work.doc), [handle.work.doc]);
  const read = useDuctSnapshot(
    demo ? null : doc,
    page.epoch,
    staged.parameters,
    staged.labelParameter,
  );
  const snapshot = demo?.snapshot ?? read.snapshot;
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
  const error = demo ? null : read.error;
  const pending = demo ? false : read.pending;
  const catalogs = useDuctCatalogs(page.epoch);
  const tables = useDuctTables(doc?.session ?? null);
  useEffect(() => {
    setProvided({
      catalogs: { state: "ready", observation: catalogs.tables },
      ducts: snapshot ? { state: "ready", observation: snapshot } : { state: "absent" },
      tables: tables.grids ? { state: "ready", observation: tables.grids } : { state: "absent" },
    });
  }, [snapshot, tables.grids, catalogs.tables]);
  // The system's groups (Work's subject cells and claims key on group ids, never shown).
  const systemGroups = useMemo(
    () => (snapshot && page.system ? systemScope(snapshot, page.system).groups : []),
    [snapshot, page.system],
  );
  // The subject scene is the person's staged subject, else Pea's proposal, of the system's first
  // group that has one; null until one exists.
  const subjectIds = demo
    ? demo.subject
    : systemGroups
        .map((g) => staged.subject[g] ?? handle.work.doc?.subject?.[g]?.proposal?.value)
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
              const value = cell.staged?.value ?? cell.proposal?.value;
              return value ? [[id, value] as const] : [];
            }),
          ),
    [demo, demoClaims, handle.work.doc],
  );
  const claims = useMemo(() => {
    if (!page.system || !snapshot) return claimsOf(claimCells);
    const members = [...systemScope(snapshot, page.system).members];
    return claimsOf(claimsForGroup(claimCells, members));
  }, [claimCells, page.system, snapshot]);
  const subject = useMemo(
    () =>
      subjectIds
        ? { ids: subjectIds, claims, work: demo ? null : handle.work.doc, onVerdict }
        : null,
    [demo, subjectIds, claims, handle.work.doc, onVerdict],
  );
  // Pricing a large model takes a few seconds: a snapshot is first priced only after a paint that
  // says "pricing…"; a Work change on a priced snapshot reprices in place (the cache keeps the
  // snapshot's solve, so only `next` is redone).
  const [painted, setPainted] = useState<object | null>(null);
  useEffect(() => {
    if (!snapshot || !tables.grids || painted === snapshot) return;
    const timer = setTimeout(() => setPainted(snapshot), 0);
    return () => clearTimeout(timer);
  }, [snapshot, tables.grids, painted]);
  const priced = useMemo(
    () =>
      snapshot && tables.grids && painted === snapshot
        ? price(snapshot, tables.grids, handle.work.doc, catalogs.tables)
        : null,
    [snapshot, tables.grids, painted, handle.work.doc, catalogs.tables],
  );
  const reading = useMemo<LoadedDuctsReading | null>(
    () => (snapshot ? { snapshot, drawn: priced?.snapshot ?? null, claims: claimCells } : null),
    [snapshot, priced?.snapshot, claimCells],
  );
  loadedReading.current = reading;
  const reconciled = reconcileDuctsMembers(page, reading);
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
    observation: NativeObservation;
  } | null>(null);
  if (snapshot && priced)
    lastPriced.current = { key: documentKey, snapshot, priced, observation: nativeObservation };
  const held =
    !priced && lastPriced.current?.key === documentKey && (pending || !!snapshot)
      ? lastPriced.current
      : null;
  const pricing = !!snapshot && !!tables.grids && !priced && !held;
  // The Work every pane reads: the model's stored rulings under the person's pending ones.
  const seen = useMemo(
    () => withStoredRulings(handle.work.doc, snapshot?.store),
    [handle.work.doc, snapshot],
  );

  const ready = useMemo(
    () => (snapshot ? readiness(snapshot, handle.work.doc) : {}),
    [snapshot, handle.work.doc],
  );
  const groups = snapshot?.groups ?? [];
  const levels = snapshot?.levels ?? [];
  const onPose = useDuctsViewBridge({
    thread,
    url,
    page,
    setPage,
    document: doc,
    reading,
    membersReady,
  });
  const systems = useMemo(() => (snapshot ? systemsOf(snapshot) : []), [snapshot]);
  const system = systems.find((item) => item.name === page.system) ?? null;
  const level = levels.find((item) => String(item.id) === page.level) ?? null;
  const readWord =
    !doc && !SAVED && !demo
      ? "choose a document first"
      : error
        ? `ducts.snapshot failed: ${error}`
        : pending
          ? "reading ducts…"
          : "this document has no duct networks";
  const busy = handle.busy !== null;
  // The system's fan static: its worst fan's, over the runs that price its terminals in every group
  // it is in (a shared group's other runs are other systems'), as staged (`next`, the solve the
  // sidebar reads); Revit's own critical path beside it.
  const solved = useMemo(() => {
    if (!system || !priced) return null;
    const scope = systemScope(priced.snapshot, system.name);
    const paths = [...scope.terminals].flatMap((t) => priced.next.paths[t] ?? []);
    const worst = worstRun(priced.next, scope.groups, scope.terminals);
    return {
      // A group with an implausible row has no price: no fan static, never a partial sum.
      blocked: [...scope.groups].some((g) => (priced.next.byGroup[g]?.implausible.length ?? 0) > 0),
      fan: [...scope.groups].some((g) => (priced.next.byGroup[g]?.implausible.length ?? 0) > 0)
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
  const lossesWord = !snapshot
    ? readingWord
    : pending
      ? `${readingWord}; the bars show the last read`
      : tables.error
        ? `ducts.tables failed: ${tables.error}`
        : !tables.grids
          ? "reading the ASHRAE tables"
          : !priced
            ? "pricing…"
            : solved?.fanless
              ? "no air mover; priced from the open end"
              : solved?.blocked
                ? "needs a fix: implausible loss (no Pe fan; nothing is written to Revit for it)"
                : solved
                  ? `Pe fan ${fmt(solved.fan)} in-wg${provisionalWords(solved.provisional)} (not in Revit until written), Revit ${revitSays(solved.revitCritical)}`
                  : `largest Pe fan ${fmt(priced.next.fan)} in-wg${provisionalWords(priced.next.provisional)} over ${systems.length} systems`;
  // Every written segment's cells count in the Work sentence.
  const counted = useMemo(
    () =>
      Object.fromEntries(
        WRITTEN.flatMap((segment) =>
          Object.entries(handle.work.doc?.[segment] ?? {}).map(
            ([key, cell]) => [`${segment}:${key}`, cell as TrichotomyCellLike] as const,
          ),
        ),
      ),
    [handle.work.doc],
  );

  const sentence = (
    <>
      on {SAVED ? "saved snapshot" : <LadderPicker ladder={ladder} disabled={busy} />}
      {", "}
      <Ladder
        levels={[
          {
            key: "system",
            label: system
              ? system.classification
                ? `${system.name} (${system.classification})`
                : system.name
              : null,
            placeholder: "every system",
            // A system by its name, classification and the tags of the units rooting it; never a group id.
            options: snapshot
              ? systems.map((item) => ({
                  id: item.name,
                  label: item.name,
                  sub: [
                    item.classification,
                    item.units.join(", ") || "no fan",
                    `${item.terminals} terminal${item.terminals === 1 ? "" : "s"}`,
                    item.groups.length > 1 ? `${item.groups.length} networks` : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))
              : null,
            note: readWord,
            picked: (id) => id === page.system,
            pick: (id) =>
              setPage({ system: id === page.system ? "" : id, selected: "", issue: "" }),
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
      : error
        ? { says: `ducts.snapshot failed: ${error}`, exit: "refresh once the host answers" }
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
  const shell: ProtoProps = {
    snapshot: held?.snapshot ?? snapshot,
    priced: held?.priced ?? priced,
    pricing,
    findings: catalogs.findings,
    ready,
    subject,
    claims,
    onVerdict,
    claimCells: demoClaims,
    page,
    setPage,
    onPose,
    onSelect,
    onSelectClaim,
    work,
    empty,
    doc,
    reading: { pending, error: error ?? null, refreshing: !!held || (pending && !!snapshot) },
    actions,
    staged: pendingCount(handle.work.doc, snapshot?.store),
  };

  return (
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
                document: SAVED ? "saved snapshot" : demo ? "scene fixture" : ladder.docWord,
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
      <NativeObservationScope value={held?.observation ?? nativeObservation}>
        <EScreen props={shell} />
      </NativeObservationScope>
    </Surface>
  );
}
