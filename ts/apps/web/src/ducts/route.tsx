/**
 * /ducts — the Situation over one document's duct networks. The sentence names the document, the
 * subject group, the level and the layers; the body is the view `page.view` names (the tables by
 * default). The snapshot is one `ducts.snapshot` read keyed on the target, the staged parameter
 * slots and `page.epoch`; targeting a document reads it again with no press, choosing a group does not.
 * The losses view is the `losses` stage: it also reads `ducts.tables`, and both reads are
 * provided to the verbs so `preview` and `apply` build their request from what is drawn.
 */
import { useEffect, useMemo, useState } from "react";
import { stagedDucts, type DuctClaim, type TrichotomyCellLike } from "@pe/agent-contracts";
import type { Reading } from "@pe/agent-contracts";

import { Surface } from "#/components/lang/surface";
import { frozenDemo } from "#/host/demo-client";
import { SAVED, useDuctSnapshot, useDuctTables, useDuctCatalogs } from "./host";
import { SCENE_CLAIMS, SCENE_FIXTURE, SCENE_SUBJECT } from "./scene.fixture";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { manifest, previewFresh, WRITTEN, type DuctsPage } from "./manifest";
import { DuctsLosses, revitSays, StagedLosses } from "./losses-view";
import { price } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { verdictPatches } from "./claims";
import { claimsOf, type Claim } from "./legs";
import { DuctsLedger } from "./ledger";
import { provisionalWords } from "./provisional";
import { DuctsSpatial, type Subject } from "./spatial";
import { DuctsTables } from "./tables";
import { DuctsTree } from "./tree";
import type { ProtoProps } from "./proto/props";
import { PrototypeSwitcher, type VariantId } from "./proto/switcher";
import { VariantB } from "./proto/variant-b";
import { VariantC } from "./proto/variant-c";
import { VariantD } from "./proto/variant-d";
import { VariantE2 } from "./proto/variant-e2";

/** The views `page.view` keys; "" is the tables. */
const VIEWS = [
  { id: "", label: "tables", sub: "groups, segments, issues and layers" },
  { id: "tree", label: "tree", sub: "one-line schematic from the root to each terminal" },
  { id: "ledger", label: "ledger", sub: "the Manual D worksheet: runs, issues and assumptions" },
  {
    id: "losses",
    label: "losses",
    sub: "per grille, what eats the pressure; stage fitting tables and drops, then write to Revit",
  },
  { id: "plan", label: "a plan", sub: "the network on one level" },
  { id: "iso", label: "an isometric", sub: "the network across every level" },
] as const;

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(4));

/** The URL half of the page; the rest (epoch, stage) is ephemeral. */
export type DuctsSearch = Pick<
  DuctsPage,
  "view" | "group" | "level" | "selected" | "issue" | "encoding" | "scene"
> & {
  layers: string;
};

const layerWord = (keys: readonly string[], snapshot: DuctSnapshot | null) =>
  keys.length === 0
    ? null
    : keys
        .map((key) => snapshot?.layers.find((layer) => layer.key === key)?.title ?? key)
        .join(", ");

export function DuctsRoute({
  search,
  setSearch,
  variant,
}: {
  search: DuctsSearch;
  setSearch: (next: Partial<DuctsSearch>) => void;
  /** THROWAWAY protoui: `?variant=E2|B|C|D` swaps the body for a prototype. */
  variant?: VariantId;
}) {
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  // `?demo=scene` mounts the makeup-air fixture, snapshot included, and no host is read; its
  // subject and claims have the staged cells' shapes, and a verdict press stays in this page.
  const demo = useMemo(() => (frozenDemo() === "scene" ? SCENE_FIXTURE : null), []);
  const [demoClaims, setDemoClaims] = useState<Record<string, DuctClaim>>(SCENE_CLAIMS);
  // The snapshot and tables are read below, once the target resolves; the verbs see them here.
  const [provided, setProvided] = useState<
    Record<"ducts" | "tables" | "catalogs", Reading<unknown>>
  >({
    ducts: { state: "absent" },
    tables: { state: "absent" },
    catalogs: { state: "absent" },
  });
  const handle = useRoute(manifest, {
    target: chosen,
    thread,
    provided,
    page: {
      ...search,
      stage: search.view === "losses" ? "losses" : "survey",
      layers: search.layers ? search.layers.split(",") : [],
    },
  });
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const staged = useMemo(() => stagedDucts(handle.work.doc), [handle.work.doc]);
  const read = useDuctSnapshot(
    demo ? null : doc,
    page.epoch,
    staged.parameters,
    staged.labelParameter,
  );
  const snapshot = demo?.snapshot ?? read.snapshot;
  const error = demo ? null : read.error;
  const pending = demo ? false : read.pending;
  // The spatial views ink Pe's losses, so they read the tables too; the other views do not.
  const priceable = page.view === "losses" || page.view === "plan" || page.view === "iso";
  const catalogs = useDuctCatalogs(page.epoch);
  const tables = useDuctTables(priceable ? (doc?.session ?? null) : null);
  useEffect(() => {
    setProvided({
      catalogs: { state: "ready", observation: catalogs.tables },
      ducts: snapshot ? { state: "ready", observation: snapshot } : { state: "absent" },
      tables: tables.grids ? { state: "ready", observation: tables.grids } : { state: "absent" },
    });
  }, [snapshot, tables.grids, catalogs.tables]);
  // The subject scene is the person's staged subject, else Pea's proposal; null until one exists.
  const subjectIds = demo
    ? demo.subject
    : (staged.subject ?? handle.work.doc?.subject?.proposal?.value);
  const subject = useMemo(() => {
    if (!subjectIds) return null;
    const cells = demo
      ? demoClaims
      : Object.fromEntries(
          Object.entries(handle.work.doc?.claims ?? {}).flatMap(([id, cell]) => {
            const value = cell.staged?.value ?? cell.proposal?.value;
            return value ? [[id, value] as const] : [];
          }),
        );
    return {
      ids: subjectIds,
      claims: claimsOf(cells),
      work: demo ? null : handle.work.doc,
      onVerdict: (claim: Claim, verdict: NonNullable<Claim["verdict"]>) => {
        if (demo) {
          setDemoClaims((prev) => ({ ...prev, [claim.id]: { ...prev[claim.id]!, verdict } }));
          return;
        }
        void handle.work.write(verdictPatches(handle.work.doc, claim, verdict));
      },
    };
  }, [demo, demoClaims, subjectIds, handle.work.doc, handle.work.write]);
  const priced = useMemo(
    () =>
      snapshot && tables.grids
        ? price(snapshot, tables.grids, handle.work.doc, catalogs.tables)
        : null,
    [snapshot, tables.grids, handle.work.doc, catalogs.tables],
  );

  // The URL carries the view, subject, level, layers and selection, so a link lands on the same place.
  useEffect(() => {
    const layers = page.layers.join(",");
    if (
      page.view !== search.view ||
      page.group !== search.group ||
      page.level !== search.level ||
      page.selected !== search.selected ||
      page.issue !== search.issue ||
      page.encoding !== search.encoding ||
      page.scene !== search.scene ||
      layers !== search.layers
    )
      setSearch({
        view: page.view,
        group: page.group,
        level: page.level,
        selected: page.selected,
        issue: page.issue,
        encoding: page.encoding,
        scene: page.scene,
        layers,
      });
  }, [
    page.view,
    page.group,
    page.level,
    page.selected,
    page.issue,
    page.encoding,
    page.scene,
    page.layers,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = useMemo(
    () => (snapshot ? readiness(snapshot, handle.work.doc) : {}),
    [snapshot, handle.work.doc],
  );
  const groups = snapshot?.groups ?? [];
  const levels = snapshot?.levels ?? [];
  const group = groups.find((item) => item.id === page.group) ?? null;
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
  const solved = group ? priced?.now.byGroup[group.id] : null;
  // With the network engine on, ducts.snapshot takes about 30 s on a large model: say so.
  const reading = snapshot?.document.networkBasedCalculations
    ? "reading ducts.snapshot (about 30 s with network-based calculations on)"
    : "reading ducts.snapshot";
  const lossesWord = !snapshot
    ? reading
    : pending
      ? `${reading}; the bars show the last read`
      : tables.error
        ? `ducts.tables failed: ${tables.error}`
        : !priced
          ? "reading the ASHRAE tables"
          : group && group.rootIds.length === 0
            ? "no air mover; priced from the open end"
            : group
              ? `Pe fan ${fmt(solved?.fan)} in-wg${provisionalWords(solved?.provisional ?? null)} (not in Revit until written), Revit ${revitSays(solved?.revitCritical)}`
              : `largest Pe fan ${fmt(priced.now.fan)} in-wg${provisionalWords(priced.now.provisional)} over ${snapshot.groups.length} groups`;
  // Every written segment's cells count in the Work sentence; the losses body is the band.
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
            key: "group",
            label: group
              ? `${group.id} (${group.classifications.join(", ") || "unclassified"})`
              : null,
            placeholder: "every group",
            options: snapshot
              ? groups.map((item) => ({
                  id: item.id,
                  label: item.id,
                  sub: `${ready[item.id]?.level ?? ""} · ${item.elementCount} elements · ${item.systemNames.slice(0, 3).join(", ")}`,
                }))
              : null,
            note: readWord,
            picked: (id) => id === page.group,
            pick: (id) => setPage({ group: id === page.group ? "" : id, selected: "", issue: "" }),
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
      {", as "}
      <Ladder
        levels={[
          {
            key: "view",
            label: VIEWS.find((item) => item.id === page.view)?.label ?? page.view,
            placeholder: "tables",
            options: VIEWS.map((item) => ({
              id: item.id || "tables",
              label: item.label,
              sub: item.sub,
            })),
            picked: (id) => id === (page.view || "tables"),
            pick: (id) =>
              setPage({
                view: id === "tables" ? "" : id,
                stage: id === "losses" ? "losses" : "survey",
              }),
          },
        ]}
        disabled={busy}
      />
      {page.view === "losses" ? (
        <>
          {"; "}
          {lossesWord}.
        </>
      ) : (
        <>
          {", drawing "}
          {layerWord(page.layers, snapshot) ?? "no layers"}.
        </>
      )}
    </>
  );

  // Stable between renders so the memoized losses blocks hold.
  const preview = page.evaluation?.response ?? null;
  const work = useMemo(
    () => ({
      doc: handle.work.doc,
      revision: handle.work.revision,
      write: handle.work.write,
      preview,
    }),
    [handle.work.doc, handle.work.revision, handle.work.write, preview],
  );
  const empty =
    !doc && !SAVED && !demo
      ? { says: "no document bound", exit: "choose a document in the sentence" }
      : error
        ? { says: `ducts.snapshot failed: ${error}`, exit: "refresh once the host answers" }
        : !snapshot
          ? { says: "reading ducts…", exit: "wait for the snapshot" }
          : null;

  // THROWAWAY protoui: the props every variant receives; the fixture stands in when no host snapshot.
  const [hovered, setHovered] = useState<number | null>(null);
  const fromFixture = !!variant && !snapshot;
  const protoSubject = useMemo<Subject | null>(
    () =>
      fromFixture
        ? { ids: SCENE_SUBJECT, claims: claimsOf(SCENE_CLAIMS), onVerdict: () => {} }
        : subject,
    [fromFixture, subject],
  );
  const protoProps: ProtoProps | null = variant
    ? {
        snapshot: snapshot ?? SCENE_FIXTURE.snapshot,
        fromFixture,
        priced,
        findings: catalogs.findings,
        ready,
        subject: protoSubject,
        claims: protoSubject?.claims ?? [],
        claimCells: fromFixture ? SCENE_CLAIMS : demoClaims,
        page,
        setPage,
        onSelect: (id) => setPage({ selected: id == null ? "" : String(id), issue: "" }),
        onSelectClaim: (claim) => setPage({ selected: claim.id, issue: "" }),
        onHover: setHovered,
        hovered,
        work,
        empty: fromFixture ? null : empty,
        doc,
        reading: { pending, error: error ?? null },
      }
    : null;

  return (
    <Surface
      head={
        <RouteShell
          manifest={manifest}
          handle={handle}
          situation={
            <Situation
              handle={handle}
              commit={page.stage === "losses" ? "apply" : undefined}
              work={{
                counted,
                draw: (_summary, line) => (
                  <>
                    {catalogs.findings.map((finding) => (
                      <p key={finding} data-tone="caution">
                        {finding}
                      </p>
                    ))}
                    {page.view === "losses" && snapshot && tables.grids && priced ? (
                      <StagedLosses
                        snapshot={snapshot}
                        grids={tables.grids}
                        priced={priced}
                        evaluation={page.evaluation}
                        fresh={previewFresh(page, handle.work.revision)}
                        work={work}
                        group={page.group}
                      />
                    ) : null}
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
      {protoProps && variant ? (
        <>
          {variant === "E2" ? (
            <VariantE2 {...protoProps} />
          ) : variant === "B" ? (
            <VariantB {...protoProps} />
          ) : variant === "C" ? (
            <VariantC {...protoProps} />
          ) : (
            <VariantD {...protoProps} />
          )}
          <PrototypeSwitcher variant={variant} />
        </>
      ) : page.view === "losses" ? (
        <DuctsLosses
          snapshot={snapshot}
          grids={tables.grids}
          priced={priced}
          ready={ready}
          page={page}
          setPage={setPage}
          empty={empty}
          work={work}
        />
      ) : page.view === "tree" ? (
        <DuctsTree snapshot={snapshot} page={page} setPage={setPage} empty={empty} />
      ) : page.view === "ledger" ? (
        <DuctsLedger
          snapshot={snapshot}
          ready={ready}
          page={page}
          setPage={setPage}
          empty={empty}
          work={{ doc: work.doc, write: work.write }}
        />
      ) : page.view === "plan" || page.view === "iso" ? (
        <DuctsSpatial
          snapshot={snapshot}
          ready={ready}
          priced={priced}
          page={page}
          setPage={setPage}
          empty={empty}
          subject={subject}
          doc={doc}
        />
      ) : (
        <DuctsTables
          snapshot={snapshot}
          ready={ready}
          page={page}
          setPage={setPage}
          empty={empty}
        />
      )}
    </Surface>
  );
}
