import * as Atom from "effect/reactivity/Atom";
import { createElement, useMemo, useState, type ReactNode } from "react";
import type { PicturePage } from "@pe/agent-contracts";
import type { Finding, Mark, PictureScope, PictureSlot } from "@pe/agent-contracts/slots";
import type { SubjectKey } from "@pe/kit/lang/attention";
import { Pane } from "@pe/kit/lang/pane";
import type { TeachingPaneRender } from "@pe/kit/lang/teaching-layout";
import { useElementIndex } from "@pe/web-kernel/element-index";
import { boundsOfInstances, boundsOfPoints, center } from "@pe/web-kernel/scene/orbit";
import { Picture } from "#/scene/picture/picture";
import {
  type LayerOption,
  type PictureLayer,
  type PictureLine,
  type PictureOverlayFrame,
} from "@pe/web-kernel/scene/picture/content";
import type { SceneMeshes } from "@pe/web-kernel/scene/types";
import type { SubjectRefCode } from "../../../../../../packages/agent-contracts/src/subject-ref.ts";
import type { picturePose } from "@pe/agent-contracts/route";
import type { DrawContext } from "@pe/web-kernel/route/typed-route";
import { findingMark } from "@pe/web-kernel/route/slots/findings";
import { subjectName } from "../subject-name.ts";
import { elementOf, pictureSlot, type Captured } from "@pe/web-kernel/route/slots/picture";
import { markLayer } from "./marks.ts";
import type { PictureOverlayProps, PictureParts } from "@pe/web-kernel/route/slots/picture/overlay";

/*
 * The kernel's picture pane (ADR 0035 rules 1, 2 and 9; owner ruling 2026-11-11). A route that
 * declares `picture` gets this pane, builtin or Pod: the kernel resolves the slot's scope to the
 * capture's focus, reads and writes the pose and the selection on the Page, draws the declared
 * marks and the document's findings on captured geometry, and mounts the one `Picture`. A route
 * mounts no picture and builds no capture source; what the closed marks cannot express arrives
 * through the slot's one `overlay` hook (`overlay.tsx`).
 */
export interface PicturePaneContext {
  /** The pane's draw context; its Page carries the kernel's pose fields (`picturePose`). */
  readonly draw: DrawContext<any, typeof picturePose, any, any>;
  readonly slot: PictureSlot<any> & { overlay?(props: PictureOverlayProps<any>): unknown };
  /** The route's name: what a retained read is labelled with. */
  readonly name: string;
  /** The Page field holding the route subject, for `scope: "subject"`. */
  readonly subjectField?: string;
  /** The document's findings Work, as the mount read it. */
  readonly findings: readonly Finding[];
}

const FINDINGS: LayerOption = { key: "findings", label: "findings" };
const KERNEL_LAYERS: readonly LayerOption[] = [
  { key: "meshes", label: "meshes", chord: "M" },
  FINDINGS,
];
const PLAIN: PictureParts = {
  lines: [],
  name: subjectName,
  kinds: {},
  colour: "mono",
  readout: { summary: null },
};

export function PicturePane({ ctx }: { ctx: PicturePaneContext }) {
  const { draw, slot } = ctx;
  const field = ctx.subjectField
    ? (
        draw.page.read() as unknown as Record<
          string,
          { kind: string; ids?: readonly SubjectRefCode[] } | undefined
        >
      )[ctx.subjectField]
    : undefined;
  // ponytail: an `all` subject set holds no ids here; a route whose picture is every subject derives its scope.
  const subject = field?.kind === "ids" ? (field.ids ?? []) : [];
  const scope = pictureSlot(slot, draw, { subject, captured: [] }).read().scope;
  const picture = (parts: PictureParts) => (
    <KernelPicture ctx={ctx} scope={scope} subject={subject} parts={parts} />
  );
  return slot.overlay
    ? createElement(slot.overlay as (props: PictureOverlayProps<unknown>) => ReactNode, {
        ctx: draw,
        scope,
        picture,
      })
    : picture(PLAIN);
}

/** What the capture holds of the refs these marks name: an instance per element, else its centreline before meshes arrive. */
function capturedOf(
  meshes: SceneMeshes | null,
  lines: readonly PictureLine[],
  marks: readonly Mark[],
): Captured[] {
  const refs = new Set(
    marks.flatMap((mark) => (typeof mark.at === "string" ? [mark.at, elementOf(mark.at)] : [])),
  );
  return [...refs].flatMap((ref) => {
    const b =
      (meshes && boundsOfInstances(meshes, (instance) => instance.key === ref)) ??
      boundsOfPoints(lines.filter((line) => line.key === ref).flatMap((line) => line.points));
    return b
      ? [
          {
            ref,
            point: center(b),
            box: { min: [b.minX, b.minY, b.minZ], max: [b.maxX, b.maxY, b.maxZ] },
          } satisfies Captured,
        ]
      : [];
  });
}

function KernelPicture({
  ctx,
  scope,
  subject,
  parts,
}: {
  ctx: PicturePaneContext;
  scope: PictureScope;
  subject: readonly SubjectRefCode[];
  parts: PictureParts;
}) {
  const { draw, slot, findings } = ctx;
  const elements = useElementIndex();
  // The pose is the kernel's Page fields (`picturePose`); the selection holds SubjectKeys, and an issue is the place `issue:<key>`.
  const authored = draw.page.read();
  const ids = authored.selected.map(({ id }) => id);
  const selected = ids.join(",");
  const page: PicturePage = {
    ...authored,
    selected,
    issue: selected.startsWith("issue:") ? selected.slice(6) : "",
  };
  const selection = useMemo(
    () =>
      Atom.make<ReadonlySet<SubjectKey>>(
        new Set(ids.filter((id): id is SubjectKey => id.includes(":"))),
      ),
    [selected], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const setPage = (
    next: Partial<PicturePage>,
    move?: { readonly history?: "push" | "replace" },
  ) => {
    const { selected: picked, issue, ...pose } = next;
    if (picked !== undefined || issue !== undefined) {
      const id = picked ?? issue ?? "";
      draw.selection.set(id ? [{ kind: "focus", id }] : []);
    }
    draw.page.pose(pose, move?.history === "replace" ? "gesture" : "named");
  };

  // The scope's SubjectRefs are the capture's focus. An ElementId exists only through the pane's element
  // index and is the scene read's payload. ponytail: a box or prism scope captures nothing by itself, since
  // the scene read is addressed by element; a region read is the scene's to add.
  const scoped =
    scope.kind === "subjects"
      ? scope.refs.map((ref) => elements.idOf(elementOf(ref))).filter(Number.isFinite)
      : [];
  const focusKey = JSON.stringify([scoped, parts.focus?.walked ?? [], parts.focus?.near ?? []]);
  const focus = useMemo(() => {
    const [own, walked, near] = JSON.parse(focusKey) as [number[], number[], number[]];
    return { walked: [...new Set([...own, ...walked])], near };
  }, [focusKey]);

  // Marks and findings resolve against what the renderer holds now, so a mark follows its subject's geometry.
  const declared = slot.marks?.(draw) ?? [];
  const lines = parts.lines;
  const marksOn = (meshes: SceneMeshes | null) =>
    pictureSlot(slot, draw, { subject, captured: capturedOf(meshes, lines, declared) }).marks();
  const kernelLayers = useMemo<PictureLayer[]>(
    () => [
      {
        key: "marks",
        draw: ({ meshes }) => marksOn(meshes).flatMap((mark) => markLayer(mark) ?? []),
      },
      {
        key: "findings",
        toggle: FINDINGS.key,
        draw: ({ meshes }) =>
          findings.flatMap((finding) => {
            const own: Mark = finding.mark ?? { kind: "ring", at: finding.subject };
            return (
              markLayer(
                findingMark(finding, capturedOf(meshes, lines, [own])),
                `finding:${finding.id}`,
              ) ?? []
            );
          }),
      },
    ],
    [JSON.stringify(declared), JSON.stringify(findings), lines], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const layers = useMemo(
    () => [...(parts.layers ?? []), ...kernelLayers],
    [parts.layers, kernelLayers],
  );
  const options = parts.layerOptions ?? KERNEL_LAYERS;
  const layerOptions = useMemo(
    () =>
      options.some((option) => option.key === FINDINGS.key) ? options : [...options, FINDINGS],
    [options],
  );
  const labelled = declared.some((mark) => mark.kind === "label");
  // ponytail: a label is plain text at its projected point, with no declutter; route captions stay the overlay's.
  const overlay = (frame: PictureOverlayFrame) => (
    <>
      {parts.overlay?.(frame)}
      {labelled
        ? marksOn(frame.meshes).flatMap((mark, index) => {
            const at =
              mark.kind === "label" && typeof mark.at !== "string" && "point" in mark.at
                ? frame.project(mark.at.point)
                : null;
            return at
              ? [
                  <span
                    key={index}
                    data-picture-mark-label=""
                    className="t-small pointer-events-none absolute text-ink"
                    style={{ left: at[0], top: at[1] }}
                  >
                    {mark.says}
                  </span>,
                ]
              : [];
          })
        : null}
    </>
  );

  // The capture follows the pane's own read unless the overlay names another (a geometry read that outlives a re-price).
  const doc = draw.target?.kind === "document" ? draw.target.ref : null;
  const follows = parts.source ?? {
    version: draw.value.state === "ready" ? (draw.value.publication?.evaluation ?? "") : "",
    current: draw.value.state === "ready",
  };
  const { focus: _focus, layerOptions: _options, source: _source, label, jump, ...content } = parts;
  return (
    <Picture
      selection={selection}
      source={{
        native: follows.current && doc && follows.version ? doc : null,
        doc,
        version: follows.version,
        label: label ?? ctx.name,
        refreshing: !follows.current,
      }}
      page={page}
      setPage={setPage}
      renderPane={renderPane}
      jump={jump}
      content={{ ...content, focus, layers, layerOptions, overlay }}
    />
  );
}

/**
 * The picture's furniture. The legend is an ordinary floater, not the kit pane's fixed legend: a field
 * at most 28rem wide or 22rem tall folds every floater to a chip (kit `lang.css`, `pane-field`), and
 * the fixed legend is the one thing that rule exempts, so it covered a small picture (drive
 * gate-b2caafd3, fix line 2). House L2: nothing covers the field unless the person placed it.
 */
const renderPane: TeachingPaneRender = (body, furniture) => (
  <PictureFrame furniture={furniture}>{body}</PictureFrame>
);
function PictureFrame({
  furniture,
  children,
}: {
  furniture: Parameters<TeachingPaneRender>[1];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const { legend, floaters = [], ...rest } = furniture ?? {};
  const all =
    legend == null || legend === false
      ? floaters
      : [
          ...floaters,
          {
            key: "legend",
            kind: "legend" as const,
            label: "legend",
            place: "bl" as const,
            open,
            onOpenChange: setOpen,
            render: () => legend,
          },
        ];
  return (
    <Pane picture scroll="clip" flush {...rest} floaters={all} legend={null}>
      {children}
    </Pane>
  );
}
