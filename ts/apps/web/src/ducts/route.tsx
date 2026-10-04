/**
 * /ducts — the Situation over one document's duct networks. The sentence names the document, the
 * subject group, the level and the layers; the body is the view `page.view` names (the tables by
 * default). The snapshot is one `ducts.snapshot` read keyed on the target, the staged parameter
 * slots and `page.epoch`; targeting a document or choosing a group reads it again with no press.
 * The losses view is the `losses` stage: it also reads `ducts.tables`, and both reads are
 * provided to the verbs so `preview` and `apply` build their request from what is drawn.
 */
import { useEffect, useMemo, useState } from "react";
import { stagedDucts, type TrichotomyCellLike } from "@pe/agent-contracts";
import type { Reading } from "@pe/agent-contracts";

import { Surface } from "#/components/lang/surface";
import { SAVED, useDuctSnapshot, useDuctTables } from "./host";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { useDocumentLadder } from "#/route/situation-ladder";
import { manifest, previewFresh, WRITTEN, type DuctsPage } from "./manifest";
import { DuctsLosses, revitSays, StagedLosses } from "./losses-view";
import { price } from "./pricing";
import { readiness, type DuctSnapshot } from "./readiness";
import { DuctsLedger } from "./ledger";
import { DuctsTables } from "./tables";
import { DuctsTree } from "./tree";

/** The views `page.view` keys; "" is the tables. */
const VIEWS = [
  { id: "", label: "tables", sub: "groups, segments, issues and layers" },
  { id: "tree", label: "tree", sub: "one-line schematic from the root to each terminal" },
  { id: "ledger", label: "ledger", sub: "the Manual D worksheet: runs, issues and assumptions" },
  {
    id: "losses",
    label: "losses",
    sub: "per grille, what eats the pressure; stage fitting tables and drops, then apply to Revit",
  },
] as const;

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(4));

/** The URL half of the page; the rest (epoch, stage) is ephemeral. */
export type DuctsSearch = Pick<DuctsPage, "view" | "group" | "level" | "selected"> & {
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
}: {
  search: DuctsSearch;
  setSearch: (next: Partial<DuctsSearch>) => void;
}) {
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  // The snapshot and tables are read below, once the target resolves; the verbs see them here.
  const [provided, setProvided] = useState<Record<"ducts" | "tables", Reading<unknown>>>({
    ducts: { state: "absent" },
    tables: { state: "absent" },
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
  const { snapshot, error, pending } = useDuctSnapshot(
    doc,
    page.epoch,
    page.group,
    staged.parameters,
  );
  const tables = useDuctTables(page.view === "losses" ? (doc?.session ?? null) : null);
  useEffect(() => {
    setProvided({
      ducts: snapshot ? { state: "ready", observation: snapshot } : { state: "absent" },
      tables: tables.grids ? { state: "ready", observation: tables.grids } : { state: "absent" },
    });
  }, [snapshot, tables.grids]);
  const priced = useMemo(
    () => (snapshot && tables.grids ? price(snapshot, tables.grids, handle.work.doc) : null),
    [snapshot, tables.grids, handle.work.doc],
  );

  // The URL carries the view, subject, level, layers and selection, so a link lands on the same place.
  useEffect(() => {
    const layers = page.layers.join(",");
    if (
      page.view !== search.view ||
      page.group !== search.group ||
      page.level !== search.level ||
      page.selected !== search.selected ||
      layers !== search.layers
    )
      setSearch({
        view: page.view,
        group: page.group,
        level: page.level,
        selected: page.selected,
        layers,
      });
  }, [page.view, page.group, page.level, page.selected, page.layers]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = useMemo(
    () => (snapshot ? readiness(snapshot, handle.work.doc) : {}),
    [snapshot, handle.work.doc],
  );
  const groups = snapshot?.groups ?? [];
  const levels = snapshot?.levels ?? [];
  const group = groups.find((item) => item.id === page.group) ?? null;
  const level = levels.find((item) => String(item.id) === page.level) ?? null;
  const read =
    !doc && !SAVED
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
              ? `Pe fan ${fmt(solved?.fan)} in-wg, Revit ${revitSays(snapshot, solved?.revitCritical)}`
              : `largest Pe fan ${fmt(priced.now.fan)} in-wg over ${snapshot.groups.length} groups`;
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
      on <Ladder levels={ladder.levels} disabled={busy} caution={ladder.lost} />
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
            note: read,
            picked: (id) => id === page.group,
            pick: (id) => setPage({ group: id === page.group ? "" : id, selected: "" }),
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
            note: read,
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
    !doc && !SAVED
      ? { says: "no document bound", exit: "choose a document in the sentence" }
      : error
        ? { says: `ducts.snapshot failed: ${error}`, exit: "refresh once the host answers" }
        : !snapshot
          ? { says: "reading ducts…", exit: "wait for the snapshot" }
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
                document: SAVED ? "saved snapshot" : ladder.docWord,
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
                ["source", SAVED ? "saved" : "host"],
              ]}
            />
          }
        />
      }
    >
      {page.view === "losses" ? (
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
          work={{ doc: handle.work.doc, write: handle.work.write }}
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
