/**
 * /family — the anatomy triptych: true-scale FRONT / SIDE / PLAN of the profile.
 *
 * Honest elevations, drawn from the numbers the table is showing for the type on stage. It is a
 * reading of the PROFILE, not a render of Revit — every value resolves through the same paths the
 * table uses, so a rebind, a ghost-row edit, or a typed override moves the drawing on the next
 * render. When a value is a formula or missing, the drawing draws from what feeds it or says so
 * in words rather than guessing.
 *
 * TWO HONEST PATHS, ONE DRAWING (phase C, 2026-08-17):
 *
 *   FIXTURE  — no document open. `buildParts` below still knows the six fixture slugs by name,
 *              placement rules as per-slug constants. Unchanged, and honest about its scope: a
 *              world it does not recognise draws the empty state.
 *   LIVE     — a `model` prop arrives (the parsed document). The DRAFT is composed over it
 *              (`draftedModel`) and the real evaluator (`family-model`'s `buildSheet`) resolves
 *              frames, planes, faces and connectors properly — so the drawing shows the page's
 *              live truth: type a number in the table and the geometry moves.
 *
 * THE RPs ARE DRAWN. A reference plane whose axis is in-plane renders as a labelled line — these
 * are the dims the FF processor will create, so hovering a param-driven plane lights its
 * parameter's row exactly as a dim chip would. A plane the evaluator cannot place (formula-driven,
 * no resolvable offset) is NAMED in words under the drawing, never drawn at a guess. Frames get a
 * small origin cross only where every needed axis resolves; the room point keeps its old marker
 * (leader + dot) on a viz rung, because it is a KIND of thing, not a state.
 *
 * GHOSTS: every OTHER type is drawn behind the staged one as a thin outline at the same fixed
 * scale, so a type comparison needs no second drawing. Fixed scale is the law here — a taller
 * type draws TALLER rather than being refitted to the box. On the live lane the scale comes from
 * `sheetBounds` INCLUDING ghosts, so it holds still while you stage different types.
 *
 * COLOUR HERE IS TAXONOMY, NOT STATE. A solid and a connector are two KINDS of thing, which is
 * exactly what the viz ladder is for; nothing in this drawing carries a verdict, so nothing in it
 * may wear a meaning role. Material is plain ink; connectors keep their taxonomy hue; the void's
 * dash is the one legal dash AMONG PARTS (declared volume with no material behind it) — the datum
 * crosshair and the room point's leader are annotation, not parts; that distinction still needs a
 * ruling. FOCUS is page vocabulary, not drawing vocabulary: a `--r-select` fill and
 * an ink stroke, exactly as the table's focused row does.
 */
import { useMemo } from "react";

import { EmptyState } from "#/components/lang/empty";
import {
  buildSheet,
  sheetBounds,
  type FamilyModel,
  type ConnGeo,
  type SolidGeo,
} from "#/family/family-model";
import {
  bindingOf,
  effective,
  inches,
  type Draft,
  type Focus,
  type PageWorld,
} from "#/family/model";
import { draftedModel } from "#/family/project";
import { boundParam } from "#/family/world";
import { cn } from "#/lib/utils";

// ── the parts, resolved for one type ────────────────────────────────────────────────────────────

type Axis = "x" | "y" | "z";

/** One drawable constituent in world inches. Boxes and cylinders are z-up with their x/y centre
 * on the family origin unless offset; connectors are a point + an outward normal. */
type Part =
  | {
      slug: string;
      kind: "box" | "cyl";
      isVoid?: boolean;
      /** x extent (a cylinder's diameter doubles as its y extent). */
      w: number;
      d: number;
      z0: number;
      h: number;
    }
  | {
      slug: string;
      kind: "conn";
      /** null when the constituent authors no diameter dim — drawn as a fixed glyph, honestly. */
      dia: number | null;
      pos: Record<Axis, number>;
      normal: { axis: Axis; sign: 1 | -1 };
      stub: number | null;
    };

/** A dim resolved THROUGH its binding: bound → the parameter at this type, unbound → the frozen
 * literal. This is what makes bind/unbind and ghost-row edits visible in the drawing. */
function dimOf(
  world: PageWorld,
  draft: Draft,
  typeName: string,
  slug: string,
  property: string,
): number | null {
  const binding = bindingOf(world, draft, slug, property);
  const param = boundParam(binding);
  return param ? inches(effective(draft, param, typeName)) : inches(binding);
}

function buildParts(world: PageWorld, draft: Draft, typeName: string): Part[] {
  const dim = (slug: string, property: string) => dimOf(world, draft, typeName, slug, property);
  const bodyW = dim("body", "width");
  const bodyD = dim("body", "depth");
  const bodyH = dim("body", "height");
  const topD = dim("top-neck", "diameter");
  const topH = dim("top-neck", "height");
  const parts: Part[] = [];

  if (bodyW != null && bodyH != null)
    parts.push({ slug: "body", kind: "box", w: bodyW, d: bodyD ?? bodyW, z0: 0, h: bodyH });
  if (topD != null && topH != null && bodyH != null)
    // Hosted on the body's top face — its origin moves when Body Height moves.
    parts.push({ slug: "top-neck", kind: "cyl", w: topD, d: topD, z0: bodyH, h: topH });

  // Core Height is a formula, so the void is drawn from what FEEDS it rather than from a literal.
  const boreDia = dim("core-bore", "diameter");
  const coreLen =
    inches(effective(draft, "Core Height", typeName)) ??
    (bodyH != null && topH != null ? bodyH + topH : null);
  if (boreDia != null && coreLen != null)
    parts.push({
      slug: "core-bore",
      kind: "cyl",
      isVoid: true,
      w: boreDia,
      d: boreDia,
      z0: 0,
      h: coreLen,
    });

  const supplyDia = dim("supply-air", "diameter");
  if (supplyDia != null && bodyH != null)
    parts.push({
      slug: "supply-air",
      kind: "conn",
      dia: supplyDia,
      pos: { x: 0, y: 0, z: bodyH + (topH ?? 0) },
      normal: { axis: "z", sign: 1 },
      stub: dim("supply-air", "stub.depth"),
    });

  const returnZ = dim("return-air", "elevation");
  if (returnZ != null && bodyW != null)
    parts.push({
      slug: "return-air",
      kind: "conn",
      dia: dim("return-air", "diameter"),
      pos: { x: -bodyW / 2, y: 0, z: returnZ },
      normal: { axis: "x", sign: -1 },
      stub: dim("return-air", "stub.depth"),
    });

  const pipeZ = dim("condensate", "elevation");
  if (pipeZ != null && bodyW != null)
    parts.push({
      slug: "condensate",
      kind: "conn",
      dia: null, // the fixture authors no diameter dim on the drain — the glyph says so
      pos: { x: bodyW / 2, y: 0, z: pipeZ },
      normal: { axis: "x", sign: 1 },
      stub: dim("condensate", "stub.depth"),
    });

  return parts;
}

// ── the three views ─────────────────────────────────────────────────────────────────────────────

interface ViewDef {
  key: string;
  label: string;
  u: Axis;
  v: Axis;
  depth: Axis;
}

const VIEWS: ViewDef[] = [
  { key: "front", label: "front · looking −Y", u: "x", v: "z", depth: "y" },
  { key: "side", label: "side · looking +X", u: "y", v: "z", depth: "x" },
  { key: "plan", label: "plan · looking −Z", u: "x", v: "y", depth: "z" },
];

/** Fixed viewBox, fixed scale: the drawing must be comparable between types, so a taller type
 * draws TALLER rather than being refitted to the same box. */
const SCALE = 3;
const BOX = 200;
const M = 12;

const AXES: Axis[] = ["x", "y", "z"];

/** "+Z" / "-X" → axis + sign; the evaluator reports normals as signed axis names. */
const NORMAL_RE = /^([+-])([XYZ])$/;

/** World extent of a box/cyl part along one axis. */
function range(part: Extract<Part, { kind: "box" | "cyl" }>, axis: Axis): [number, number] {
  if (axis === "x") return [-part.w / 2, part.w / 2];
  if (axis === "y") return [-part.d / 2, part.d / 2];
  return [part.z0, part.z0 + part.h];
}

/** Hovering LIGHTS, clicking OPENS — the same two-step the table's rows use, so the drawing is
 * not a separate interaction vocabulary you have to learn beside it. */
const hoverProps = (
  slug: string,
  onFocus: (focus: Focus) => void,
  onInspect: (slug: string) => void,
) => ({
  onMouseEnter: () => onFocus({ kind: "part" as const, id: slug }),
  onMouseLeave: () => onFocus(null),
  onClick: () => onInspect(slug),
  style: { cursor: "pointer" as const },
});

export function AnatomyDrawing({
  world,
  draft,
  typeName,
  model,
  focusedParts,
  focusedParams,
  onFocus,
  onInspect,
  inspecting,
}: {
  world: PageWorld;
  draft: Draft;
  typeName: string;
  /** null → the declared fixture lane (buildParts). Non-null → the parsed document, drawn through
   * the real evaluator with the draft composed over it. */
  model: FamilyModel | null;
  focusedParts: Set<string>;
  /** Which parameter rows are lit — a param-driven plane IS a dim of its parameter, so it lights
   * with the row and lights the row back. */
  focusedParams: Set<string>;
  onFocus: (focus: Focus) => void;
  /** A constituent is something you can OPEN, not just light. */
  onInspect: (slug: string) => void;
  inspecting: string | null;
}) {
  const views =
    model == null ? (
      <FixtureViews
        world={world}
        draft={draft}
        typeName={typeName}
        focusedParts={focusedParts}
        onFocus={onFocus}
        onInspect={onInspect}
      />
    ) : (
      <ModelViews
        model={model}
        world={world}
        draft={draft}
        typeName={typeName}
        focusedParts={focusedParts}
        focusedParams={focusedParams}
        onFocus={onFocus}
        onInspect={onInspect}
      />
    );

  return (
    <div className="flex size-full min-h-0">
      {views}
      <div className="min-w-0 flex-1 overflow-y-auto p-2">
        <p
          className="face-mono mb-1 t-caption text-[var(--r-ink-2)]"
          title="The profile's own constituent list. Hovering one lights both the shape and the table rows it drives, because there is only ever ONE thing in focus. Clicking OPENS it in the doc pane's lower half, where the half of it no parameter can drive — direction, system type, where its frame sits — is edited."
        >
          constituents · {typeName}
        </p>
        {world.constituents.map((part) => {
          const geom = world.geomBySlug.get(part.slug);
          const unbound =
            geom?.dims.filter(
              (dim) => boundParam(bindingOf(world, draft, part.slug, dim.property)) == null,
            ).length ?? 0;
          return (
            <button
              key={part.slug}
              type="button"
              onMouseEnter={() => onFocus({ kind: "part", id: part.slug })}
              onMouseLeave={() => onFocus(null)}
              onClick={() => onInspect(part.slug)}
              title={`${part.text} — consumes ${part.params.length > 0 ? part.params.join(", ") : "no parameter the profile names, which is worth a second look"}.${
                geom
                  ? ` Click to open it: ${geom.kind}, ${geom.dims.length} bindable dims${unbound > 0 ? ` (${unbound} of them UNBOUND — frozen literals, waiting at the bottom of the table)` : " (all bound)"}, and ${geom.meta.length} non-bindable properties that live only in the inspector.`
                  : ""
              }`}
              className={cn(
                "face-mono flex w-full items-center gap-1 truncate rounded-[2px] border px-1 py-0.5 text-left t-caption",
                // Selection is a FILL, not a hue: the open constituent sits in the selection rung,
                // the hovered one wears a hairline. Neither is a state of the model.
                inspecting === part.slug
                  ? "border-[var(--r-line-2)] bg-[var(--r-select)] text-[var(--r-ink)]"
                  : focusedParts.has(part.slug)
                    ? "border-[var(--r-line-2)] text-[var(--r-ink)]"
                    : "border-transparent text-[var(--r-ink)]",
              )}
            >
              <span className="text-[var(--r-ink-2)]">{part.kind} </span>
              <span className="min-w-0 truncate">{part.slug}</span>
              {unbound > 0 && (
                <span
                  className="ml-auto shrink-0 t-caption text-[var(--r-caution)]"
                  title={`${unbound} of this constituent's dimensions are frozen literals no parameter drives. They are the ghost rows at the bottom of the table.`}
                >
                  {unbound}⚠
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── the FIXTURE lane: the six known slugs, per-slug placement constants ─────────────────────────

function FixtureViews({
  world,
  draft,
  typeName,
  focusedParts,
  onFocus,
  onInspect,
}: {
  world: PageWorld;
  draft: Draft;
  typeName: string;
  focusedParts: Set<string>;
  onFocus: (focus: Focus) => void;
  onInspect: (slug: string) => void;
}) {
  const parts = buildParts(world, draft, typeName);
  const body = parts.find((part) => part.slug === "body");

  if (!body)
    return (
      <EmptyState
        story="scope"
        exit="give Body Width and Body Height literal values at this type, or stage a type that has them"
        className="p-3"
      >
        no shape to draw — the body&apos;s width or height is not a literal at this type, and
        nothing here guesses
      </EmptyState>
    );

  /** Every OTHER type's solids, as outlines at the same scale. */
  const ghosts = Object.keys(draft.types)
    .filter((name) => name !== typeName)
    .map((name) => ({ typeName: name, parts: buildParts(world, draft, name) }));

  const partFill = (slug: string) => (focusedParts.has(slug) ? "var(--r-select)" : "transparent");
  const partStroke = (slug: string) => (focusedParts.has(slug) ? "var(--r-ink)" : "var(--r-ink-2)");
  /** Connectors are a KIND, not a state — the one legitimate viz spend on this page. */
  const connectorStroke = (slug: string) =>
    focusedParts.has(slug) ? "var(--r-ink)" : "var(--viz-4)";
  const hover = (slug: string) => hoverProps(slug, onFocus, onInspect);

  return (
    <>
      {VIEWS.map((view) => {
        // Elevations hang off the datum at the bottom; the plan centres on the origin.
        const X = (u: number) => BOX / 2 + u * SCALE;
        const Y = (v: number) => (view.v === "z" ? BOX - 25 - v * SCALE : BOX / 2 - v * SCALE);

        const solidRect = (part: Extract<Part, { kind: "box" | "cyl" }>) => {
          const [u0, u1] = range(part, view.u);
          const [v0, v1] = range(part, view.v);
          return { x: X(u0), y: Y(v1), width: (u1 - u0) * SCALE, height: (v1 - v0) * SCALE };
        };

        return (
          <svg
            key={view.key}
            viewBox={`0 0 ${BOX} ${BOX}`}
            className="h-full border-r border-[var(--r-line)]"
            role="img"
            aria-label={`family ${view.key} view`}
          >
            <title>{`${view.label} — true scale, resolved as the ${typeName} type. The other types are the thin outlines behind it.`}</title>

            {/* datum: elevations get a ground line, the plan gets the origin crosshair */}
            {view.v === "z" ? (
              <line
                x1={M}
                y1={Y(0)}
                x2={BOX - M}
                y2={Y(0)}
                stroke="var(--r-line-2)"
                strokeWidth={0.5}
              />
            ) : (
              <>
                <line
                  x1={M}
                  y1={Y(0)}
                  x2={BOX - M}
                  y2={Y(0)}
                  stroke="var(--r-line)"
                  strokeWidth={0.5}
                  strokeDasharray="2 4"
                />
                <line
                  x1={X(0)}
                  y1={M}
                  x2={X(0)}
                  y2={BOX - M}
                  stroke="var(--r-line)"
                  strokeWidth={0.5}
                  strokeDasharray="2 4"
                />
              </>
            )}

            {/* ghost outlines — non-interactive, so they never steal a hover from the real parts */}
            {ghosts.map((ghost) =>
              ghost.parts
                .filter(
                  (part): part is Extract<Part, { kind: "box" | "cyl" }> =>
                    part.kind !== "conn" && !part.isVoid,
                )
                .map((part) => {
                  const shared = {
                    fill: "none",
                    stroke: "var(--r-line-2)",
                    strokeWidth: 0.75,
                    opacity: 0.5,
                    pointerEvents: "none" as const,
                  };
                  if (view.depth === "z" && part.kind === "cyl")
                    return (
                      <circle
                        key={`${ghost.typeName}:${part.slug}`}
                        cx={X(0)}
                        cy={Y(0)}
                        r={(part.w / 2) * SCALE}
                        {...shared}
                      />
                    );
                  return (
                    <rect key={`${ghost.typeName}:${part.slug}`} {...solidRect(part)} {...shared} />
                  );
                }),
            )}

            {parts.map((part) => {
              if (part.kind !== "conn") {
                const active = focusedParts.has(part.slug);
                const prose = world.source.profile.solids[part.slug] ?? "";
                const title = (
                  <title>
                    {part.isVoid
                      ? `${part.slug} — ${prose}. Core Height is a formula, so this is drawn from what feeds it rather than from a literal. Dashed because it is a SUBTRACTION: declared volume with no material behind it.`
                      : `${part.slug} — ${prose}. Drawn true to the ${typeName} type's numbers; hovering it lights the parameters it consumes in the table.`}
                  </title>
                );
                /* THE ONE LEGAL DASH AMONG PARTS: a void must never read as material. */
                const shared = {
                  ...hover(part.slug),
                  fill: part.isVoid ? "none" : partFill(part.slug),
                  stroke: part.isVoid
                    ? active
                      ? "var(--r-ink)"
                      : "var(--r-line-2)"
                    : partStroke(part.slug),
                  strokeWidth: 0.8,
                  strokeDasharray: part.isVoid ? "3 2" : undefined,
                };
                if (view.depth === "z" && part.kind === "cyl")
                  return (
                    <circle
                      key={part.slug}
                      cx={X(0)}
                      cy={Y(0)}
                      r={(part.w / 2) * SCALE}
                      {...shared}
                    >
                      {title}
                    </circle>
                  );
                return (
                  <rect key={part.slug} {...solidRect(part)} {...shared}>
                    {title}
                  </rect>
                );
              }

              const prose = world.source.profile.connectors[part.slug] ?? "";
              const stroke = connectorStroke(part.slug);
              const u = part.pos[view.u];
              const v = part.pos[view.v];
              const active = focusedParts.has(part.slug);

              // Face-on: the connector's normal runs along the view's depth, so its face projects
              // as its true shape. A drain with no authored diameter draws a fixed glyph — the
              // tooltip says the size is a glyph, not a claim.
              if (part.normal.axis === view.depth) {
                const r = part.dia != null ? (part.dia / 2) * SCALE : 3;
                return (
                  <circle
                    key={part.slug}
                    {...hover(part.slug)}
                    cx={X(u)}
                    cy={Y(v)}
                    r={r}
                    fill={partFill(part.slug)}
                    stroke={stroke}
                    strokeWidth={active ? 1.4 : 0.8}
                  >
                    <title>
                      {`${part.slug} — ${prose}. Face-on in this view${part.dia != null ? `, ${part.dia}in across` : " — no diameter dim authored, so the size here is a glyph, not a claim"}.`}
                    </title>
                  </circle>
                );
              }

              // In-plane: the stub — a line running the stub depth along the normal, with a face
              // tick across it at the connection plane.
              const stubLen = part.stub ?? 2;
              const girth = part.dia != null ? part.dia * SCALE : 6;
              const du = part.normal.axis === view.u ? part.normal.sign : 0;
              const dv = part.normal.axis === view.v ? part.normal.sign : 0;
              const x0 = X(u);
              const y0 = Y(v);
              const x1 = X(u + du * stubLen);
              const y1 = Y(v + dv * stubLen);
              return (
                <g key={part.slug} {...hover(part.slug)}>
                  <title>
                    {`${part.slug} — ${prose}. The tick is the connection face; the line is the stub${part.stub != null ? `, ${part.stub}in deep` : ""}.`}
                  </title>
                  {/* a fat transparent hit line, so a 1px stub is still hoverable */}
                  <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="transparent" strokeWidth={9} />
                  <line
                    x1={x0}
                    y1={y0}
                    x2={x1}
                    y2={y1}
                    stroke={stroke}
                    strokeWidth={active ? 1.6 : 1}
                  />
                  {du !== 0 ? (
                    <line
                      x1={x1}
                      y1={Y(v - girth / 2 / SCALE)}
                      x2={x1}
                      y2={Y(v + girth / 2 / SCALE)}
                      stroke={stroke}
                      strokeWidth={active ? 1.6 : 1}
                    />
                  ) : (
                    <line
                      x1={X(u - girth / 2 / SCALE)}
                      y1={y1}
                      x2={X(u + girth / 2 / SCALE)}
                      y2={y1}
                      stroke={stroke}
                      strokeWidth={active ? 1.6 : 1}
                    />
                  )}
                </g>
              );
            })}

            <text
              x={M}
              y={BOX - 5}
              fontSize={7}
              fill="var(--r-ink-2)"
              className="face-mono uppercase"
            >
              {view.label}
            </text>
          </svg>
        );
      })}
    </>
  );
}

// ── the LIVE lane: whatever document is open, through the real evaluator ───────────────────────

function ModelViews({
  model,
  world,
  draft,
  typeName,
  focusedParts,
  focusedParams,
  onFocus,
  onInspect,
}: {
  model: FamilyModel;
  world: PageWorld;
  draft: Draft;
  typeName: string;
  focusedParts: Set<string>;
  focusedParams: Set<string>;
  onFocus: (focus: Focus) => void;
  onInspect: (slug: string) => void;
}) {
  // THE DRAFT IS THE TRUTH BEING DRAWN: page edits not yet saved are composed over the parsed
  // document before the evaluator sees it — type a number, watch the geometry move.
  const drafted = useMemo(() => draftedModel(model, draft, world), [model, draft, world]);
  const sheet = useMemo(() => buildSheet(drafted, typeName), [drafted, typeName]);
  const bounds = useMemo(() => sheetBounds(sheet), [sheet]);

  const drawable = sheet.solids.some((geo) => geo.h != null && (geo.w != null || geo.d != null));
  if (!drawable)
    return (
      <EmptyState
        story="scope"
        exit="give the document's solids values that resolve to numbers at this type, or stage a type where they do"
        className="p-3"
      >
        no shape to draw — no solid&apos;s dimensions resolve to numbers at this type, and nothing
        here guesses
      </EmptyState>
    );

  // ONE scale for all three views, from the bounds INCLUDING ghosts — so it does not move when a
  // different type takes the stage, and a taller type draws taller.
  const span = Math.max(...AXES.map((axis) => bounds[axis][1] - bounds[axis][0]));
  const scale = (BOX - 2 * M) / span;

  const partFill = (slug: string) => (focusedParts.has(slug) ? "var(--r-select)" : "transparent");
  const partStroke = (slug: string) => (focusedParts.has(slug) ? "var(--r-ink)" : "var(--r-ink-2)");
  const connectorStroke = (slug: string) =>
    focusedParts.has(slug) ? "var(--r-ink)" : "var(--viz-4)";
  const hover = (slug: string) => hoverProps(slug, onFocus, onInspect);

  /** What the drawing cannot place, said in words below it rather than drawn at a guess. */
  const unplottablePlanes = sheet.planes.filter(
    (plane) => plane.axis == null || plane.offset == null,
  );
  const partialSolids = sheet.solids.filter(
    (geo) => geo.w == null || geo.d == null || geo.h == null,
  );

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {VIEWS.map((view) => {
          const [uMin, uMax] = bounds[view.u];
          const [vMin, vMax] = bounds[view.v];
          const uMid = (uMin + uMax) / 2;
          const vMid = (vMin + vMax) / 2;
          const X = (u: number) => BOX / 2 + (u - uMid) * scale;
          const Y = (v: number) => BOX / 2 - (v - vMid) * scale;

          const solidRange = (geo: SolidGeo, axis: Axis): [number, number] | null => {
            if (axis === "x") return geo.w == null ? null : [-geo.w / 2, geo.w / 2];
            if (axis === "y") return geo.d == null ? null : [-geo.d / 2, geo.d / 2];
            // v1 lowering convention: solids sit ON the datum, so z runs 0 → height.
            return geo.h == null ? null : [0, geo.h];
          };
          const solidRect = (geo: SolidGeo) => {
            const uRange = solidRange(geo, view.u);
            const vRange = solidRange(geo, view.v);
            if (!uRange || !vRange) return null;
            return {
              x: X(uRange[0]),
              y: Y(vRange[1]),
              width: (uRange[1] - uRange[0]) * scale,
              height: (vRange[1] - vRange[0]) * scale,
            };
          };

          const connMark = (conn: ConnGeo) => {
            const parsed = NORMAL_RE.exec(conn.normal);
            if (!parsed) return null;
            const axis = parsed[2]!.toLowerCase() as Axis;
            const sign = parsed[1] === "-" ? -1 : 1;
            const u = conn.pos[view.u];
            const v = conn.pos[view.v];
            // A frame axis the evaluator could not resolve is a position this drawing may not
            // invent — the connector simply does not appear in this view.
            if (u == null || v == null) return null;
            const active = focusedParts.has(conn.slug);
            const stroke = connectorStroke(conn.slug);
            const prose =
              world.source.profile.connectors[conn.slug] ?? `${conn.domain} · ${conn.shape}`;

            // Face-on: the normal runs along the view's depth, so the face projects true.
            if (axis === view.depth) {
              if (conn.shape === "Round" && conn.w != null)
                return (
                  <circle
                    key={conn.slug}
                    {...hover(conn.slug)}
                    cx={X(u)}
                    cy={Y(v)}
                    r={(conn.w / 2) * scale}
                    fill={partFill(conn.slug)}
                    stroke={stroke}
                    strokeWidth={active ? 1.4 : 0.8}
                  >
                    <title>{`${conn.slug} — ${prose}. Face-on in this view, ${conn.w}in across, drawn where its frame resolves.`}</title>
                  </circle>
                );
              if (conn.w != null && conn.h != null)
                return (
                  <rect
                    key={conn.slug}
                    {...hover(conn.slug)}
                    x={X(u - conn.w / 2)}
                    y={Y(v + conn.h / 2)}
                    width={conn.w * scale}
                    height={conn.h * scale}
                    fill={partFill(conn.slug)}
                    stroke={stroke}
                    strokeWidth={active ? 1.4 : 0.8}
                  >
                    <title>{`${conn.slug} — ${prose}. Face-on in this view, ${conn.w}×${conn.h}in, drawn where its frame resolves.`}</title>
                  </rect>
                );
              return (
                <circle
                  key={conn.slug}
                  {...hover(conn.slug)}
                  cx={X(u)}
                  cy={Y(v)}
                  r={3}
                  fill={partFill(conn.slug)}
                  stroke={stroke}
                  strokeWidth={active ? 1.4 : 0.8}
                >
                  <title>{`${conn.slug} — ${prose}. Face-on — its size dims do not resolve at this type, so the size here is a glyph, not a claim.`}</title>
                </circle>
              );
            }

            // In-plane: the stub — a line along the normal with a face tick at the connection
            // plane. The stub direction is the document's; In pulls it back into the family.
            const stubLen = conn.stub ?? 2;
            const dir = sign * (conn.stubDir === "In" ? -1 : 1);
            const girth = conn.w ?? 2;
            const du = axis === view.u ? dir : 0;
            const dv = axis === view.v ? dir : 0;
            const x0 = X(u);
            const y0 = Y(v);
            const x1 = X(u + du * stubLen);
            const y1 = Y(v + dv * stubLen);
            return (
              <g key={conn.slug} {...hover(conn.slug)}>
                <title>
                  {`${conn.slug} — ${prose}. The tick is the connection face; the line is the stub${conn.stub != null ? `, ${conn.stub}in ${conn.stubDir === "In" ? "into the family" : "standing off"}` : ""}.`}
                </title>
                {/* a fat transparent hit line, so a 1px stub is still hoverable */}
                <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="transparent" strokeWidth={9} />
                <line
                  x1={x0}
                  y1={y0}
                  x2={x1}
                  y2={y1}
                  stroke={stroke}
                  strokeWidth={active ? 1.6 : 1}
                />
                {du !== 0 ? (
                  <line
                    x1={x0}
                    y1={Y(v - girth / 2)}
                    x2={x0}
                    y2={Y(v + girth / 2)}
                    stroke={stroke}
                    strokeWidth={active ? 1.6 : 1}
                  />
                ) : (
                  <line
                    x1={X(u - girth / 2)}
                    y1={y0}
                    x2={X(u + girth / 2)}
                    y2={y0}
                    stroke={stroke}
                    strokeWidth={active ? 1.6 : 1}
                  />
                )}
              </g>
            );
          };

          return (
            <svg
              key={view.key}
              viewBox={`0 0 ${BOX} ${BOX}`}
              className="h-full border-r border-[var(--r-line)]"
              role="img"
              aria-label={`family ${view.key} view`}
            >
              <title>{`${view.label} — true scale, resolved as the ${typeName} type through the document's own bindings. The other types are the thin outlines behind it.`}</title>

              {/* datum: elevations get a ground line, the plan gets the origin crosshair */}
              {view.v === "z" ? (
                <line
                  x1={M}
                  y1={Y(0)}
                  x2={BOX - M}
                  y2={Y(0)}
                  stroke="var(--r-line-2)"
                  strokeWidth={0.5}
                />
              ) : (
                <>
                  <line
                    x1={M}
                    y1={Y(0)}
                    x2={BOX - M}
                    y2={Y(0)}
                    stroke="var(--r-line)"
                    strokeWidth={0.5}
                    strokeDasharray="2 4"
                  />
                  <line
                    x1={X(0)}
                    y1={M}
                    x2={X(0)}
                    y2={BOX - M}
                    stroke="var(--r-line)"
                    strokeWidth={0.5}
                    strokeDasharray="2 4"
                  />
                </>
              )}

              {/* ghost outlines — non-interactive, so they never steal a hover */}
              {sheet.ghosts.map((ghost) =>
                ghost.solids
                  .filter((geo) => !geo.isVoid)
                  .map((geo) => {
                    const shared = {
                      fill: "none",
                      stroke: "var(--r-line-2)",
                      strokeWidth: 0.75,
                      opacity: 0.5,
                      pointerEvents: "none" as const,
                    };
                    if (view.depth === "z" && geo.isCyl && geo.w != null)
                      return (
                        <circle
                          key={`${ghost.typeName}:${geo.slug}`}
                          cx={X(0)}
                          cy={Y(0)}
                          r={(geo.w / 2) * scale}
                          {...shared}
                        />
                      );
                    const rect = solidRect(geo);
                    return rect ? (
                      <rect key={`${ghost.typeName}:${geo.slug}`} {...rect} {...shared} />
                    ) : null;
                  }),
              )}

              {sheet.solids.map((geo) => {
                const active = focusedParts.has(geo.slug);
                const prose = world.source.profile.solids[geo.slug] ?? geo.kind;
                const title = (
                  <title>
                    {geo.isVoid
                      ? `${geo.slug} — ${prose}. Dashed because it is a SUBTRACTION: declared volume with no material behind it.`
                      : `${geo.slug} — ${prose}. Drawn true to the ${typeName} type's numbers; hovering it lights the parameters it consumes in the table.`}
                  </title>
                );
                /* THE ONE LEGAL DASH AMONG PARTS: a void must never read as material. */
                const shared = {
                  ...hover(geo.slug),
                  fill: geo.isVoid ? "none" : partFill(geo.slug),
                  stroke: geo.isVoid
                    ? active
                      ? "var(--r-ink)"
                      : "var(--r-line-2)"
                    : partStroke(geo.slug),
                  strokeWidth: 0.8,
                  strokeDasharray: geo.isVoid ? "3 2" : undefined,
                };
                if (view.depth === "z" && geo.isCyl && geo.w != null)
                  return (
                    <circle key={geo.slug} cx={X(0)} cy={Y(0)} r={(geo.w / 2) * scale} {...shared}>
                      {title}
                    </circle>
                  );
                const rect = solidRect(geo);
                if (!rect) return null;
                return (
                  <rect key={geo.slug} {...rect} {...shared}>
                    {title}
                  </rect>
                );
              })}

              {/* reference planes — the dims the processor will create. A plane is a reading of
                  its parameter, so it lights with that ROW, not with a constituent. */}
              {sheet.planes.map((plane) => {
                if (plane.axis == null || plane.offset == null) return null;
                if (plane.axis !== view.u && plane.axis !== view.v) return null;
                const param = plane.param;
                const lit = param != null && focusedParams.has(param);
                const stroke = lit ? "var(--r-ink)" : "var(--r-line-2)";
                const line =
                  plane.axis === view.u
                    ? { x1: X(plane.offset), y1: M, x2: X(plane.offset), y2: BOX - M }
                    : { x1: M, y1: Y(plane.offset), x2: BOX - M, y2: Y(plane.offset) };
                return (
                  <g
                    key={plane.slug}
                    onMouseEnter={param ? () => onFocus({ kind: "param", id: param }) : undefined}
                    onMouseLeave={param ? () => onFocus(null) : undefined}
                  >
                    <title>
                      {param
                        ? `plane ${plane.slug} — a reference plane sitting ${plane.text} off its datum, driven by ${param}. It is a dim the processor will create; hovering lights that parameter's row in the table.`
                        : `plane ${plane.slug} — a reference plane sitting ${plane.text} off its datum. No parameter drives it.`}
                    </title>
                    <line {...line} stroke="transparent" strokeWidth={7} />
                    <line {...line} stroke={stroke} strokeWidth={lit ? 1.2 : 0.6} />
                    <text
                      x={plane.axis === view.u ? line.x1 + 2 : M + 1}
                      y={plane.axis === view.u ? M + 6 : line.y1 - 2}
                      fontSize={6}
                      fill={lit ? "var(--r-ink)" : "var(--r-ink-2)"}
                      className="face-mono"
                    >
                      {plane.slug} {plane.text}
                    </text>
                  </g>
                );
              })}

              {/* frame origins — a small cross ONLY where both in-plane axes resolve; a frame
                  with a null axis is skipped, never guessed. */}
              {sheet.frames.map((frame) => {
                const u = frame.pos[view.u];
                const v = frame.pos[view.v];
                if (u == null || v == null) return null;
                return (
                  <g key={frame.slug} stroke="var(--r-ink-2)" strokeWidth={0.6}>
                    <title>{`frame ${frame.slug} — its origin, where the document's plane and face references intersect. Facing ${frame.normal}. Whatever sits on this frame is placed here.`}</title>
                    <line x1={X(u) - 2.5} y1={Y(v)} x2={X(u) + 2.5} y2={Y(v)} />
                    <line x1={X(u)} y1={Y(v) - 2.5} x2={X(u)} y2={Y(v) + 2.5} />
                  </g>
                );
              })}

              {sheet.conns.map(connMark)}

              {/* the room point: a KIND of thing, so it wears a viz rung. Its leader is
                  annotation, not a part — see the dash note in the header. */}
              {sheet.rcp && sheet.rcp[view.u] != null && sheet.rcp[view.v] != null && (
                <g>
                  <title>
                    {`roomCalculationPoint — enabled, drawn at the fixed PE convention (12in, ${model.family.placement === "Unhosted" ? "+Z" : "−Y"}). The leader ties it back to the family origin.`}
                  </title>
                  <line
                    x1={X(0)}
                    y1={Y(0)}
                    x2={X(sheet.rcp[view.u] as number)}
                    y2={Y(sheet.rcp[view.v] as number)}
                    stroke="var(--viz-5)"
                    strokeWidth={0.8}
                    strokeDasharray="1.5 3"
                  />
                  <circle
                    cx={X(sheet.rcp[view.u] as number)}
                    cy={Y(sheet.rcp[view.v] as number)}
                    r={2.5}
                    fill="var(--viz-5)"
                  />
                </g>
              )}

              <text
                x={M}
                y={BOX - 5}
                fontSize={7}
                fill="var(--r-ink-2)"
                className="face-mono uppercase"
              >
                {view.label}
              </text>
            </svg>
          );
        })}
      </div>

      {(unplottablePlanes.length > 0 || partialSolids.length > 0) && (
        <div className="shrink-0 border-t border-[var(--r-line)] px-2 py-1">
          {partialSolids.map((geo) => (
            <p key={geo.slug} className="face-mono t-caption text-[var(--r-ink-2)]">
              ─ ─ solid {geo.slug} · {world.source.profile.solids[geo.slug] ?? geo.kind}{" "}
              <span className="text-[var(--r-ink-mute)]">
                (a dimension does not resolve to a number at this type — named rather than drawn at
                a guess)
              </span>
            </p>
          ))}
          {unplottablePlanes.map((plane) => (
            <p key={plane.slug} className="face-mono t-caption text-[var(--r-ink-2)]">
              ─ ─ plane {plane.slug} · {plane.text}{" "}
              <span className="text-[var(--r-ink-mute)]">
                {plane.offset == null
                  ? "(formula-driven — no resolvable offset, so it is named rather than drawn at a guess)"
                  : "(off a datum this drawing does not recognise)"}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
