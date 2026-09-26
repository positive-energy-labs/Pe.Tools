/**
 * /ducts — the Situation over one document's duct networks. The sentence names the document, the
 * subject group, the level and the layers; the body is the view `page.view` names (the tables by
 * default). The snapshot is one `ducts.snapshot` read keyed on the target and `page.epoch`;
 * targeting a document or choosing a group reads it again with no press.
 */
import { useEffect, useMemo } from "react";

import { Surface } from "#/components/lang/surface";
import { SAVED, useDuctSnapshot } from "./host";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { manifest, type DuctsPage } from "./manifest";
import { readiness, type DuctSnapshot } from "./readiness";
import { DuctsLedger } from "./ledger";
import { DuctsSpatial } from "./spatial";
import { DuctsTables } from "./tables";
import { DuctsTree } from "./tree";

/** The views `page.view` keys; "" is the tables. */
const VIEWS = [
  { id: "", label: "tables", sub: "groups, segments, issues and layers" },
  { id: "tree", label: "tree", sub: "one-line schematic from the root to each terminal" },
  { id: "ledger", label: "ledger", sub: "the Manual D worksheet: runs, issues and assumptions" },
  { id: "plan", label: "a plan", sub: "the network on one level" },
  { id: "iso", label: "an isometric", sub: "the network across every level" },
] as const;

/** The URL half of the page; the rest (epoch, stage) is ephemeral. */
export type DuctsSearch = Pick<
  DuctsPage,
  "view" | "group" | "level" | "selected" | "issue" | "encoding"
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
}: {
  search: DuctsSearch;
  setSearch: (next: Partial<DuctsSearch>) => void;
}) {
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  const handle = useRoute(manifest, {
    target: chosen,
    thread,
    page: { ...search, layers: search.layers ? search.layers.split(",") : [] },
  });
  const [page, setPage] = handle.page;
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const { snapshot, error, pending } = useDuctSnapshot(doc, page.epoch, page.group, handle.work);

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
      layers !== search.layers
    )
      setSearch({
        view: page.view,
        group: page.group,
        level: page.level,
        selected: page.selected,
        issue: page.issue,
        encoding: page.encoding,
        layers,
      });
  }, [page.view, page.group, page.level, page.selected, page.issue, page.encoding, page.layers]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const sentence = (
    <>
      on <LadderPicker ladder={ladder} disabled={busy} />
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
            pick: (id) => setPage({ view: id === "tables" ? "" : id }),
          },
        ]}
        disabled={busy}
      />
      {", drawing "}
      {layerWord(page.layers, snapshot) ?? "no layers"}.
    </>
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
      {page.view === "tree" ? (
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
      ) : page.view === "plan" || page.view === "iso" ? (
        <DuctsSpatial
          snapshot={snapshot}
          ready={ready}
          page={page}
          setPage={setPage}
          empty={empty}
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
