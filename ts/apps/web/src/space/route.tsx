/**
 * /space: what `Pe.Revit.Space` holds for one document, drawn on the spatial kit. The sentence
 * names the document and the host element ids a capture asks for; `capture` and `context` write
 * the new scene's hash to the page (the only writers of `scene`), and the scene artifact that hash
 * names is fetched and decoded once (`useSceneArtifact`), never captured on a URL read. Each answer
 * verb's result rides the Page and draws as one layer over the meshes.
 *
 * `?demo=fixture` mounts a synthetic PSC1 scene and one fixture answer per op; no host is read.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { spaceElementKey, type Reading } from "@pe/agent-contracts";
import { Input } from "@pe/kit/lang/input";
import { SubjectText } from "@pe/kit/lang/subject-text";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { RegistryContext } from "@effect/atom-react";
import { AttentionRoot } from "#/attention";
import { useRevitSubjectProps } from "#/revit/element-menu";

import { Surface } from "@pe/kit/lang/surface";
import { frozenDemo } from "#/host/demo-client";
import { RouteShell, useRoute, useRouteThread } from "#/route";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { LadderPicker, useDocumentLadder } from "#/route/situation-ladder";
import { NativeObservationScope, type NativeObservation } from "#/revit/observation";
import type { Psc1Metadata } from "#/scene/psc1";
import { PictureReadout } from "@pe/kit/lang/readout";
import { useSceneArtifact } from "#/scene/use-scene";
import type { Layer3D } from "#/scene/types";

import { CutControls } from "./cut-controls";
import { AnswerForms, EncodingLegend, PickFacts, SceneSummary, pickName } from "./facts";
import { FIXTURE_ANSWERS, FIXTURE_SCENE } from "./fixture";
import {
  boxesLayer,
  legendOf,
  levelsLayer,
  probeLayer,
  sliceLayer,
  sweepLayer,
  treeLayer,
  type SpaceLayer,
} from "./layers";
import {
  bindSpaceManifest,
  reconcileSpaceMembers,
  spaceSceneMembers,
  type LoadedSpaceScene,
} from "./manifest";
import { SpacePicture } from "./picture";
import { rowAt } from "./layers";
import { cutPolygons } from "./state";

const idsText = (ids: readonly number[]) => ids.join(", ");
const DEMO_PAGE = {
  ...FIXTURE_ANSWERS,
  ids: [201, 202],
  layers: ["meshes", "context", "cuts", "boxes", "levels"] as SpaceLayer[],
};

/** `url` is false in a chat pane, which does not own the address. */
export function SpaceRoute({ url = true }: { url?: boolean } = {}) {
  const demo = useMemo(() => frozenDemo() === "fixture", []);
  const [chosen] = useChooseTarget();
  const thread = useRouteThread();
  const loadedScene = useRef<LoadedSpaceScene | null>(null);
  const manifest = useMemo(() => bindSpaceManifest(() => loadedScene.current), []);
  const [provided, setProvided] = useState<{ scene: Reading<unknown> }>({
    scene: { state: "absent" },
  });
  const handle = useRoute(manifest, {
    target: chosen,
    thread,
    provided,
    url,
    page: demo ? DEMO_PAGE : undefined,
  });
  const [page, setPage] = handle.page;
  const read = useSceneArtifact(demo ? null : (page.scene ?? null));
  const meshes = demo ? FIXTURE_SCENE.meshes : read.meshes;
  const metadata: Psc1Metadata | null = demo ? FIXTURE_SCENE.metadata : read.metadata;
  const scene = useMemo<LoadedSpaceScene | null>(
    () =>
      metadata && meshes
        ? { id: page.scene, metadata, members: spaceSceneMembers(metadata) }
        : null,
    [metadata, meshes, page.scene],
  );
  loadedScene.current = scene;
  const reconciled = scene ? reconcileSpaceMembers(page, scene) : {};
  const membersReady = Object.keys(reconciled).length === 0;
  const reconciledPage = useRef<object | null>(null);
  useEffect(() => {
    if (scene && !membersReady && reconciledPage.current !== page) {
      reconciledPage.current = page;
      setPage(reconcileSpaceMembers(page, scene), { history: "replace" });
    }
  }, [scene, page, membersReady, setPage]);
  useEffect(() => {
    setProvided({
      scene: metadata ? { state: "ready", observation: metadata } : { state: "absent" },
    });
  }, [metadata]);
  const ladder = useDocumentLadder(handle);
  const doc =
    handle.resolution.kind === "resolved" && handle.resolution.target.kind === "document"
      ? handle.resolution.target.ref
      : null;
  const [error, setError] = useState<string | null>(null);
  const [ids, setIds] = useState(idsText(page.ids));
  useEffect(() => setIds(idsText(page.ids)), [page.ids]);
  const commitIds = () => {
    const parts = ids.split(/[\s,]+/).filter(Boolean);
    if (!parts.every((p) => /^\d+$/.test(p)))
      return setError("Use positive host element ids separated by commas");
    setError(null);
    const next = parts.map(Number);
    if (idsText(next) !== idsText(page.ids)) setPage({ ids: next }, { history: "push" });
  };

  // The displayed scene's members (and the rows' host ids) are what the element menu may target.
  const rows = page.rows?.response ?? null;
  const nativeObservation = useMemo<NativeObservation>(
    () => ({
      scope: {
        document: demo || !metadata ? null : doc,
        source: demo ? "fixture" : "native",
        documentKey: metadata?.stamp.hostDocumentKey,
      },
      references: [
        ...(metadata?.elements ?? [])
          .filter((e) => e.handle.linkInstanceId == null)
          .map((e) => ({ elementId: e.handle.elementId, uniqueId: e.handle.uniqueId })),
        ...(rows?.elementId ?? [])
          .filter(
            (_, i) =>
              rows!.stamp.sources.find((s) => s.source === rows!.source[i])?.kind === "Host",
          )
          .map((elementId) => ({ elementId })),
      ],
    }),
    [demo, doc, metadata, rows],
  );

  const on = useMemo(() => new Set<SpaceLayer>(page.layers), [page.layers]);
  const legend = useMemo(() => (rows ? legendOf(rows, page.encoding) : []), [rows, page.encoding]);
  // One Layer3D per answer that is on, rebuilt only when its answer (or its ink) changes.
  const boxes = useMemo(
    () => (rows ? boxesLayer(rows, page.encoding, legend, page.row) : null),
    [rows, page.encoding, legend, page.row],
  );
  const levels = useMemo(
    () => (page.status && meshes ? levelsLayer(page.status.response, meshes.bounds) : null),
    [page.status, meshes],
  );
  const tree = useMemo(() => page.tree && treeLayer(page.tree.response), [page.tree]);
  const slice = useMemo(
    () => page.slice && sliceLayer(page.slice.request, page.slice.response),
    [page.slice],
  );
  const probe = useMemo(
    () => page.probe && probeLayer(page.probe.request, page.probe.response),
    [page.probe],
  );
  const sweep = useMemo(
    () => page.sweep && sweepLayer(page.sweep.request, page.sweep.response),
    [page.sweep],
  );
  const layers = useMemo(
    () =>
      (
        [
          ["boxes", boxes],
          ["levels", levels],
          ["tree", tree],
          ["slice", slice],
          ["probe", probe],
          ["sweep", sweep],
        ] as const
      ).flatMap(([key, layer]): Layer3D[] => (layer && on.has(key) ? [layer] : [])),
    [boxes, levels, tree, slice, probe, sweep, on],
  );

  const element =
    metadata?.elements.find((e) => spaceElementKey(e.handle) === page.selected) ?? null;
  const instance = meshes?.instances.find((i) => i.key === page.selected) ?? null;
  const partition = element
    ? (metadata!.stamp.sources.find(
        (s) =>
          s.documentKey === element.handle.documentKey &&
          (s.linkInstanceId ?? null) === (element.handle.linkInstanceId ?? null),
      )?.kind ?? null)
    : null;

  // The side holds only the answers' forms, the cut editor and the encoding key; with none of
  // them it is not drawn, and the picture takes the width (SURFACE-PHILOSOPHY L1).
  const side =
    (page.mode !== "3d" && !!meshes) ||
    (["levels", "boxes", "tree", "slice", "probe", "sweep"] as const).some((l) => on.has(l));
  const pickedRow = rows && page.row !== null ? rowAt(rows, page.row) : null;
  const picked = element ? pickName(element.handle) : pickedRow ? pickName(pickedRow) : null;

  const status = demo
    ? null
    : !page.scene
      ? doc
        ? "no scene: name host element ids, then capture (or load context for the whole resident world)"
        : "no scene: choose a document, then capture"
      : read.error
        ? `scene: ${read.error}`
        : read.pending
          ? "reading the scene artifact…"
          : null;
  const actions = handle.actions;
  // The requested ids as named Subjects (I1): each by what the scene says it is, numbered, and a
  // press selects it and flies there; right-click offers the element menu.
  const refProps = useRevitSubjectProps();
  const alias = useRef<((key: string) => void) | null>(null);
  const hostKeys = useMemo(
    () =>
      new Map(
        (metadata?.elements ?? [])
          .filter((e) => e.handle.linkInstanceId == null)
          .map((e) => [
            e.handle.elementId,
            { key: spaceElementKey(e.handle), name: pickName(e.handle) },
          ]),
      ),
    [metadata],
  );
  const subjects = useMemo(
    () => ({
      doc: doc ? `${doc.session}/${doc.openId}` : "fixture:space",
      nameOf: (id: number) => hostKeys.get(id)?.name ?? null,
      refProps,
      go: (id: number) => {
        const key = hostKeys.get(id)?.key;
        if (key) alias.current?.(key);
      },
    }),
    [doc, hostKeys, refProps],
  );
  const sentence = (
    <>
      on{" "}
      {demo ? (
        "the scene fixture"
      ) : (
        <LadderPicker ladder={ladder} disabled={handle.busy !== null} />
      )}
      {", host ids "}
      <span className="inline-block w-48 align-middle">
        <Input
          aria-label="Host element ids a capture asks for"
          value={ids}
          placeholder="comma separated"
          onChange={(e) => setIds(e.target.value)}
          onBlur={commitIds}
          onKeyDown={(e) => e.key === "Enter" && commitIds()}
        />
      </span>
      {metadata && page.ids.length ? (
        <SubjectTextContext value={subjects}>
          <SubjectText text={[]} revit={page.ids} />
        </SubjectTextContext>
      ) : null}
      {metadata
        ? `; scene ${metadata.phase === "focus" ? "of those alone" : "with its context"}, ${metadata.elements.length} elements`
        : "; no scene"}
      .
    </>
  );

  return (
    <RegistryContext value={handle.registry}>
      <AttentionRoot doc={subjects.doc}>
        <NativeObservationScope value={nativeObservation}>
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
                      document: demo ? "scene fixture" : ladder.docWord,
                    }}
                    sentence={sentence}
                    ledger={[
                      [
                        "scene",
                        page.scene ? `${page.scene.slice(0, 12)}…` : demo ? "fixture" : "none",
                      ],
                      [
                        "captured",
                        metadata
                          ? `${metadata.stamp.builtUtc} · epoch ${metadata.stamp.epoch} · ${metadata.stamp.fresh ? "fresh" : "stale"}`
                          : "none",
                      ],
                      ["source", demo ? "fixture" : "host"],
                    ]}
                  />
                }
              />
            }
          >
            {error && (
              <p role="alert" data-tone="alarm" className="px-2 m-0">
                {error}
              </p>
            )}
            <div className="flex min-h-0 flex-1">
              <SpacePicture
                lease={{
                  thread: thread ?? undefined,
                  ready: !!scene && membersReady,
                  context: {
                    source: demo ? "fixture" : "artifact",
                    scene: demo ? "fixture:space" : page.scene,
                    boundDocument: doc,
                    hostDocumentKey: metadata?.stamp.hostDocumentKey,
                    epoch: metadata?.stamp.epoch,
                    builtUtc: metadata?.stamp.builtUtc,
                    frame: metadata?.stamp.frame,
                  },
                }}
                meshes={meshes}
                metadata={metadata}
                page={page}
                setPage={setPage}
                layers={layers}
                status={status}
                onError={setError}
                alias={alias}
                legend={
                  on.has("boxes") && rows ? (
                    <EncodingLegend
                      encoding={page.encoding}
                      legend={legend}
                      onEncoding={(encoding) => setPage({ encoding })}
                    />
                  ) : null
                }
                readout={
                  metadata ? (
                    <PictureReadout
                      title={picked ?? undefined}
                      onClear={
                        picked
                          ? () => setPage({ selected: null, row: null }, { history: "push" })
                          : undefined
                      }
                    >
                      {picked ? (
                        <PickFacts
                          page={page}
                          element={element}
                          instance={instance}
                          partition={partition}
                          actions={actions}
                        />
                      ) : (
                        <SceneSummary metadata={metadata} demo={demo} actions={actions} />
                      )}
                    </PictureReadout>
                  ) : null
                }
              />
              {side ? (
                <aside
                  className="flex w-80 shrink-0 flex-col gap-3 overflow-auto p-2 hairline-l"
                  aria-label="Space facts"
                >
                  {page.mode !== "3d" && meshes ? (
                    <CutControls
                      axis={page.mode}
                      cuts={page.cuts}
                      bounds={meshes.bounds}
                      onCuts={(cuts, how) => {
                        try {
                          cutPolygons(cuts, meshes.bounds);
                        } catch (e) {
                          return setError((e as Error).message);
                        }
                        setError(null);
                        setPage({ cuts }, { history: how });
                      }}
                    />
                  ) : null}
                  <AnswerForms on={on} page={page} actions={actions} />
                </aside>
              ) : null}
            </div>
          </Surface>
        </NativeObservationScope>
      </AttentionRoot>
    </RegistryContext>
  );
}
