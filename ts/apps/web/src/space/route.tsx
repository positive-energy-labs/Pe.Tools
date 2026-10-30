/** /space is a graph mount; drawing and cut geometry remain in their existing bodies. */
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { spaceElementKey } from "@pe/agent-contracts";
import { SubjectTextContext } from "@pe/kit/lang/reach";
import { RegistryContext } from "@effect/atom-react";
import { AttentionRoot } from "#/attention";
import { useRevitSubjectProps } from "#/revit/element-menu";

import { NativeObservationScope } from "#/revit/observation";
import type { Psc1Metadata } from "#/scene/psc1";
import { PictureReadout } from "@pe/kit/lang/readout";
import type { Layer3D } from "#/scene/types";

import { CutControls } from "./cut-controls";
import { AnswerForms, EncodingLegend, PickFacts, SceneSummary, pickName } from "./facts";
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
import { reconcileSpaceMembers, spaceObservation } from "./members";
import { matchingScene, spaceSources } from "./sources";
import { spaceGraph, spaceBinding, answerKeys, type SpacePage } from "./graph";
import type { SpaceAnswers, SpaceReadResult } from "./reads";
import { routeFromGraph, type GraphMount, type RouteAdapters, type MountBody } from "#/shell/mount";
import { useRouteLease } from "#/route/view-bridge";
import type { PageMove } from "#/route/manifest";
import { SpacePicture } from "./picture";
import { rowAt } from "./layers";
import { cutPolygons } from "./state";

type Owner = GraphMount<SpacePage, null>;
type SetPage = (patch: Partial<SpacePage>, move?: PageMove<SpacePage>) => void;
const SpaceContext = createContext<{
  setPage: SetPage;
  error: string | null;
  setError: (message: string | null) => void;
  setFrame: (facts: Record<string, unknown> | null) => void;
} | null>(null);

function SpaceMount({ owner, children }: { owner: Owner; children: ReactNode }) {
  const page = owner.view.read().page;
  const read = owner.readings.get("scene");
  const scene = matchingScene(page, read);
  const demo = page.demo === "fixture";
  const target = owner.snapshot().target;
  const doc = target.kind === "document" ? target.ref : null;
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<Record<string, unknown> | null>(null);
  const seen = useRef(new Set<string>());
  const captures = ["capture", "context"]
    .flatMap((key) => {
      const result = owner.results.get(key);
      return result?.state === "done" && result.kind === "query" ? [result] : [];
    })
    .sort(
      (a, b) =>
        owner.timeline.read().findIndex((e) => e.press === a.press) -
        owner.timeline.read().findIndex((e) => e.press === b.press),
    );
  const latest = captures.at(-1);
  const lifetime = useRef({ target: JSON.stringify(doc), retired: new Set<string>() });
  if (lifetime.current.target !== JSON.stringify(doc)) {
    lifetime.current.target = JSON.stringify(doc);
    for (const result of captures) lifetime.current.retired.add(result.press);
  }
  const captured = latest?.receipt.value as SpaceReadResult<"revit.detail.space-scene"> | undefined;
  useEffect(() => {
    if (!latest || !captured || seen.current.has(latest.press)) return;
    seen.current.add(latest.press);
    if (captured.document.session !== doc?.session || captured.document.openId !== doc.openId)
      return;
    owner.view.setPage(
      {
        scene: captured.response.id,
        selected: null,
        hidden: [],
        isolated: null,
        viewport: null,
        row: null,
      },
      { history: "push" },
    );
  }, [owner, latest, captured, doc]);
  useEffect(() => {
    if (!scene) return;
    const patch = reconcileSpaceMembers(page, scene);
    if (Object.keys(patch).length) owner.view.setPage(patch, { history: "replace" });
  }, [owner, page, scene]);
  const setPage = useCallback<SetPage>(
    (patch, move) => {
      const current = owner.view.read().page;
      const loaded = matchingScene(current, owner.readings.get("scene"));
      // TODO: GraphTransition/VerbScope cannot read current Reading values. Move this loaded-scene
      // admission into the kernel once transitions expose them; all body and lease writes use it now.
      const candidate = { ...current, ...patch };
      if (["selected", "hidden", "isolated", "cuts"].some((key) => Object.hasOwn(patch, key))) {
        const named = [
          candidate.selected,
          ...candidate.hidden,
          ...(candidate.isolated ?? []),
        ].filter((key): key is string => key !== null);
        if (
          (named.length || Object.hasOwn(patch, "cuts")) &&
          (!loaded || loaded.id !== candidate.scene)
        ) {
          setError("Load this scene before naming its elements or changing its cuts");
          return;
        }
        const missing = named.find((key) => !loaded?.members.has(key));
        if (missing) {
          setError(`Element is not in this loaded scene: ${missing}`);
          return;
        }
        if (loaded && Object.hasOwn(patch, "cuts")) {
          try {
            cutPolygons(candidate.cuts, loaded.metadata.bounds);
          } catch (cause) {
            setError((cause as Error).message);
            return;
          }
        }
      }
      setError(null);
      owner.view.setPage(patch, move);
    },
    [owner],
  );
  const observation = spaceObservation(
    page,
    read,
    doc,
    captured && latest && !lifetime.current.retired.has(latest.press)
      ? { scene: captured.response.id, document: captured.document, stamp: captured.response.scene }
      : null,
  );
  const ready = !!scene && Object.keys(reconcileSpaceMembers(page, scene)).length === 0;
  useRouteLease("space", [page, setPage], {
    visible: ready && !!frame?.size,
    context: {
      source: demo ? "fixture" : "artifact",
      scene: demo ? "fixture:space" : page.scene,
      boundDocument: doc,
      hostDocumentKey: scene?.metadata.stamp.hostDocumentKey,
      epoch: scene?.metadata.stamp.epoch,
      builtUtc: scene?.metadata.stamp.builtUtc,
      frame: scene?.metadata.stamp.frame,
    },
    facts: {
      ...frame,
      fresh: scene?.metadata.stamp.fresh ?? false,
      modes: ["3d", "top", "north", "east"],
      layers: ["meshes", "context", "cuts", "boxes", "levels", "tree", "slice", "probe", "sweep"],
      totalElements: scene?.metadata.elements.length ?? 0,
      omittedElements: scene?.metadata.omittedElements ?? 0,
      unavailableElements: scene?.metadata.unavailableElements.length ?? 0,
      truncated: (scene?.metadata.elements.length ?? 0) > 200,
      sources: scene?.metadata.stamp.sources.slice(0, 100) ?? [],
      totalSources: scene?.metadata.stamp.sources.length ?? 0,
      sourcesTruncated: (scene?.metadata.stamp.sources.length ?? 0) > 100,
      visibilityMembersBeforeCuts:
        scene?.meshes.instances.filter(
          (instance) =>
            page.layers.includes("meshes") &&
            !page.hidden.includes(instance.key) &&
            (page.isolated === null || page.isolated.includes(instance.key)) &&
            (page.layers.includes("context") || instance.focus),
        ).length ?? 0,
      elements:
        scene?.metadata.elements.slice(0, 200).map((e) => ({
          key: spaceElementKey(e.handle),
          ...e.handle,
          bounds: e.bounds,
          focus: e.focus,
        })) ?? [],
    },
  });
  return (
    <RegistryContext value={owner.registry}>
      <AttentionRoot doc={doc ? `${doc.session}/${doc.openId}` : "fixture:space"}>
        <NativeObservationScope value={observation}>
          <SpaceContext value={{ setPage, error, setError, setFrame }}>{children}</SpaceContext>
        </NativeObservationScope>
      </AttentionRoot>
    </RegistryContext>
  );
}

function SpaceBody({ owner, page }: MountBody<SpacePage, null>) {
  const { setPage, error, setError, setFrame } = useContext(SpaceContext)!;
  const read = owner.readings.get("scene");
  const scene = matchingScene(page, read);
  const meshes = scene?.meshes ?? null;
  const metadata: Psc1Metadata | null = scene?.metadata ?? null;
  const demo = page.demo === "fixture";
  const target = owner.snapshot().target;
  const doc = target.kind === "document" ? target.ref : null;
  const answers = answersFor(owner, page);
  const rows = answers.rows?.response ?? null;
  const on = useMemo(() => new Set<SpaceLayer>(page.layers), [page.layers]);
  const legend = useMemo(() => (rows ? legendOf(rows, page.encoding) : []), [rows, page.encoding]);
  // One Layer3D per answer that is on, rebuilt only when its answer (or its ink) changes.
  const boxes = useMemo(
    () => (rows ? boxesLayer(rows, page.encoding, legend, page.row) : null),
    [rows, page.encoding, legend, page.row],
  );
  const levels = useMemo(
    () => (answers.status && meshes ? levelsLayer(answers.status.response, meshes.bounds) : null),
    [answers.status, meshes],
  );
  const tree = useMemo(() => answers.tree && treeLayer(answers.tree.response), [answers.tree]);
  const slice = useMemo(
    () => answers.slice && sliceLayer(answers.slice.request, answers.slice.response),
    [answers.slice],
  );
  const probe = useMemo(
    () => answers.probe && probeLayer(answers.probe.request, answers.probe.response),
    [answers.probe],
  );
  const sweep = useMemo(
    () => answers.sweep && sweepLayer(answers.sweep.request, answers.sweep.response),
    [answers.sweep],
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

  const pickedRow = rows && page.row !== null ? rowAt(rows, page.row) : null;
  const picked = element ? pickName(element.handle) : pickedRow ? pickName(pickedRow) : null;

  const status = demo
    ? null
    : read.error
      ? `scene: ${read.error}`
      : read.status === "pending"
        ? "reading the scene artifact..."
        : !page.scene
          ? "no scene: choose a document and capture host ids, or load context"
          : null;
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
  return (
    <SubjectTextContext value={subjects}>
      {error && (
        <p role="alert" data-tone="alarm">
          {error}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <SpacePicture
          answers={answers}
          onFrame={setFrame}
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
                    setPage={setPage}
                    answers={answers}
                  />
                ) : (
                  <SceneSummary metadata={metadata} demo={demo} page={page} setPage={setPage} />
                )}
              </PictureReadout>
            ) : null
          }
        />
      </div>
    </SubjectTextContext>
  );
}

function answersFor(owner: Owner, page: SpacePage): SpaceAnswers {
  const target = owner.snapshot().target;
  const doc = target.kind === "document" ? target.ref : null;
  const demoAnswers =
    page.demo === "fixture"
      ? (owner.readings.get("demoAnswers").value as SpaceAnswers | null)
      : null;
  return Object.fromEntries(
    answerKeys.map((key) => {
      const result = owner.results.get(key);
      const value =
        result?.state === "done" && result.kind === "query"
          ? (result.receipt.value as SpaceReadResult)
          : null;
      const valid =
        value && value.document.session === doc?.session && value.document.openId === doc.openId;
      return [key, valid ? value : (demoAnswers?.[key] ?? null)];
    }),
  ) as SpaceAnswers;
}

function FactsBody({ owner, page, verbs }: MountBody<SpacePage, null>) {
  const { setPage, setError } = useContext(SpaceContext)!;
  const meshes = matchingScene(page, owner.readings.get("scene"))?.meshes;
  const answers = answersFor(owner, page);
  const on = new Set(page.layers);
  return (
    <div className="flex flex-col gap-3">
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
      <AnswerForms on={on} page={page} setPage={setPage} answers={answers} verbs={verbs} />
    </div>
  );
}

export const spaceAdapters: RouteAdapters<SpacePage, null> = {
  sources: spaceSources,
  binding: spaceBinding,
  wrap: (owner, children) => <SpaceMount owner={owner}>{children}</SpaceMount>,
  bodies: { picture: (body) => <SpaceBody {...body} />, facts: (body) => <FactsBody {...body} /> },
};
export const spaceRoute = routeFromGraph(spaceGraph, spaceAdapters, "/space");
