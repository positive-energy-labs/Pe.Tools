/**
 * /ducts: the Situation over one document's duct networks, and the one shell under it (E2): the
 * system tree over the loss Rules, the drawing, the inbox. The sentence names the document, the
 * subject group and the level. The page is the manifest's `url` keys, so a link lands on the same
 * place. The snapshot is one `ducts.snapshot` read keyed on the target, the staged parameter slots
 * and `page.epoch`; targeting a document reads it again with no press, choosing a group does not.
 * The ASHRAE tables are always read; the snapshot, tables and catalogs are provided to the verbs so
 * `preview` and `apply` build their request from what is drawn.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { stagedDucts, type DuctClaim, type TrichotomyCellLike } from "@pe/agent-contracts";
import type { Reading } from "@pe/agent-contracts";

import { Surface } from "#/components/lang/surface";
import { frozenDemo } from "#/host/demo-client";
import { SAVED, useDuctSnapshot, useDuctTables, useDuctCatalogs } from "./host";
import { SCENE_CLAIMS, SCENE_FIXTURE } from "./scene.fixture";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { manifest, WRITTEN } from "./manifest";
import { price } from "@pe/ducts-domain/pricing";
import { readiness } from "@pe/ducts-domain/readiness";
import { verdictPatches } from "./claims";
import { claimsOf, type Claim } from "./legs";
import { claimsForGroup } from "@pe/ducts-domain/claims";
import { provisionalWords } from "./provisional";
import type { ProtoProps } from "./proto/props";
import { EScreen } from "./proto/e/screen";

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
  const catalogs = useDuctCatalogs(page.epoch);
  const tables = useDuctTables(doc?.session ?? null);
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
    : (staged.subject[page.group] ?? handle.work.doc?.subject?.[page.group]?.proposal?.value);
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
  // Claims live beside the subject, not inside it: a chosen group shows only the claims that name
  // its elements (claimsForGroup), so one system's claims never ride onto another.
  const claims = useMemo(() => {
    const cells = demo
      ? demoClaims
      : Object.fromEntries(
          Object.entries(handle.work.doc?.claims ?? {}).flatMap(([id, cell]) => {
            const value = cell.staged?.value ?? cell.proposal?.value;
            return value ? [[id, value] as const] : [];
          }),
        );
    if (!page.group || !snapshot) return claimsOf(cells);
    const members = [...snapshot.nodes, ...snapshot.segments]
      .filter((element) => element.groupId === page.group)
      .map((element) => element.id);
    return claimsOf(claimsForGroup(cells, members));
  }, [demo, demoClaims, handle.work.doc, page.group, snapshot]);
  const subject = useMemo(
    () =>
      subjectIds
        ? { ids: subjectIds, claims, work: demo ? null : handle.work.doc, onVerdict }
        : null,
    [demo, subjectIds, claims, handle.work.doc, onVerdict],
  );
  const priced = useMemo(
    () =>
      snapshot && tables.grids
        ? price(snapshot, tables.grids, handle.work.doc, catalogs.tables)
        : null,
    [snapshot, tables.grids, handle.work.doc, catalogs.tables],
  );

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
      {"; "}
      {lossesWord}.
    </>
  );

  // Stable between renders so the memoized panes hold.
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

  const [hovered, setHovered] = useState<number | null>(null);
  const shell: ProtoProps = {
    snapshot,
    priced,
    findings: catalogs.findings,
    ready,
    subject,
    claims,
    onVerdict,
    claimCells: demoClaims,
    page,
    setPage,
    onSelect: (id) => setPage({ selected: id == null ? "" : String(id), issue: "" }),
    onSelectClaim: (claim) => setPage({ selected: claim.id, issue: "" }),
    onHover: setHovered,
    hovered,
    work,
    empty,
    doc,
    reading: { pending, error: error ?? null },
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
              commit="apply"
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
      <EScreen props={shell} />
    </Surface>
  );
}
