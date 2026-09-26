/**
 * /ducts — the Situation over one document's duct networks. The sentence names the document, the
 * subject group, the level and the layers; the body is the view `page.view` names (the tables by
 * default). The snapshot is one `ducts.snapshot` read keyed on the target and `page.epoch`;
 * targeting a document or choosing a group reads it again with no press.
 */
import { useEffect, useMemo, useState } from "react";

import { Surface } from "#/components/lang/surface";
import { useHostOp } from "#/readings";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { useDocumentLadder } from "#/route/situation-ladder";
import { NATIVE_READ_WAIT_S } from "#/route/waits";
import { manifest, type DuctsPage } from "./manifest";
import { readiness, type DuctSnapshot } from "./readiness";
import { DuctsTables } from "./tables";

/** The URL half of the page; the rest (epoch, stage) is ephemeral. */
export type DuctsSearch = Pick<DuctsPage, "view" | "group" | "level" | "selected"> & {
  layers: string;
};

/**
 * Dev-only reading source: `PE_DUCTS_FIXTURE=<snapshot.json>` at `vp dev` makes the route read a
 * saved snapshot instead of the host, so a view can be built with no Revit (vite.config.ts).
 */
const FIXTURE: string | undefined = import.meta.env.DEV
  ? (import.meta.env.VITE_DUCTS_FIXTURE as string | undefined) || undefined
  : undefined;

function useFixture(epoch: number) {
  const [state, setState] = useState<{ data?: DuctSnapshot; error?: string }>({});
  useEffect(() => {
    if (!FIXTURE) return;
    let live = true;
    fetch(FIXTURE)
      .then((response) => (response.ok ? response.json() : Promise.reject(`${response.status}`)))
      .then(
        (data: DuctSnapshot) => live && setState({ data }),
        (error: unknown) => live && setState({ error: `fixture ${FIXTURE}: ${String(error)}` }),
      );
    return () => {
      live = false;
    };
  }, [epoch]);
  return {
    snapshot: state.data ?? null,
    error: state.error ?? null,
    pending: !state.data && !state.error,
  };
}

/** `ducts.snapshot` of the one document the sentence names, read again when the subject changes. */
function useDuctSnapshot(
  doc: { session: string; openId: string } | null,
  epoch: number,
  group: string,
) {
  const call = useHostOp(
    "ducts.snapshot",
    {},
    {
      bridgeSessionId: doc?.session,
      openDocumentId: doc?.openId,
      enabled: doc !== null && !FIXTURE,
      waitSeconds: NATIVE_READ_WAIT_S,
    },
  );
  // A new target is a new request (its deps change); a new subject or a refresh reads again.
  const { refresh } = call;
  useEffect(() => {
    if (epoch > 0 || group) refresh();
  }, [epoch, group, refresh]);
  const fixture = useFixture(epoch);
  if (FIXTURE) return fixture;
  return { snapshot: call.data ?? null, error: call.error?.message ?? null, pending: call.pending };
}

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
  const { snapshot, error, pending } = useDuctSnapshot(doc, page.epoch, page.group);

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
    !doc && !FIXTURE
      ? "choose a document first"
      : error
        ? `ducts.snapshot failed: ${error}`
        : pending
          ? "reading ducts…"
          : "this document has no duct networks";
  const busy = handle.busy !== null;

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
      {", drawing "}
      {layerWord(page.layers, snapshot) ?? "no layers"}.
    </>
  );

  const empty =
    !doc && !FIXTURE
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
                document: FIXTURE ? "fixture" : ladder.docWord,
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
                ["source", FIXTURE ? "fixture" : "host"],
              ]}
            />
          }
        />
      }
    >
      <DuctsTables snapshot={snapshot} ready={ready} page={page} setPage={setPage} empty={empty} />
    </Surface>
  );
}
