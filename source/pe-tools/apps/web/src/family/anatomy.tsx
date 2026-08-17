/**
 * /family — the anatomy triptych: true-scale FRONT / SIDE / PLAN of the profile.
 *
 * Honest elevations, drawn from the numbers the table is showing for the type on stage. It is a
 * reading of the PROFILE, not a render of Revit — every dimension resolves through its BINDING
 * (a bound dim reads its parameter at the staged type; an unbound dim reads its frozen literal),
 * so a rebind or a ghost-row edit moves the drawing on the next render. When a value is a formula
 * or missing, the drawing draws from what feeds it or says so in words rather than guessing.
 *
 * PLACEMENT is the fixture's frame prose made geometric: the body sits on the datum, the neck is
 * hosted on the body's top face (so it MOVES when Body Height moves), the connectors sit on the
 * faces their frames name. ponytail: placement rules are per-slug constants for the one fixture
 * family; a real placement evaluator arrives with the host lane's structured frames.
 *
 * GHOSTS: every OTHER type is drawn behind the staged one as a thin outline at the same fixed
 * scale, so a type comparison needs no second drawing. Fixed scale is the law here — a taller
 * type draws TALLER rather than being refitted to the box.
 *
 * COLOUR HERE IS TAXONOMY, NOT STATE. A solid and a connector are two KINDS of thing, which is
 * exactly what the viz ladder is for; nothing in this drawing carries a verdict, so nothing in it
 * may wear a meaning role. Material is plain ink; connectors keep their taxonomy hue; the void's
 * dash is the one legal dash (declared volume with no material behind it). FOCUS is page
 * vocabulary, not drawing vocabulary: a `--r-select` fill and an ink stroke, exactly as the
 * table's focused row does.
 */
import { EmptyState } from "#/components/lang/empty";
import {
  CONSTITUENTS,
  GEOM_BY_SLUG,
  bindingOf,
  effective,
  inches,
  type Draft,
  type Focus,
} from "#/family/model";
import { WORLD, boundParam } from "#/family/world";
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
function dimOf(draft: Draft, typeName: string, slug: string, property: string): number | null {
  const binding = bindingOf(draft, slug, property);
  const param = boundParam(binding);
  return param ? inches(effective(draft, param, typeName)) : inches(binding);
}

function buildParts(draft: Draft, typeName: string): Part[] {
  const dim = (slug: string, property: string) => dimOf(draft, typeName, slug, property);
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
    parts.push({ slug: "core-bore", kind: "cyl", isVoid: true, w: boreDia, d: boreDia, z0: 0, h: coreLen });

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

/** World extent of a box/cyl part along one axis. */
function range(part: Extract<Part, { kind: "box" | "cyl" }>, axis: Axis): [number, number] {
  if (axis === "x") return [-part.w / 2, part.w / 2];
  if (axis === "y") return [-part.d / 2, part.d / 2];
  return [part.z0, part.z0 + part.h];
}

export function AnatomyDrawing({
  draft,
  typeName,
  focusedParts,
  onFocus,
  onInspect,
  inspecting,
}: {
  draft: Draft;
  typeName: string;
  focusedParts: Set<string>;
  onFocus: (focus: Focus) => void;
  /** A constituent is something you can OPEN, not just light. */
  onInspect: (slug: string) => void;
  inspecting: string | null;
}) {
  const parts = buildParts(draft, typeName);
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
    .map((name) => ({ typeName: name, parts: buildParts(draft, name) }));

  const partFill = (slug: string) => (focusedParts.has(slug) ? "var(--r-select)" : "transparent");
  const partStroke = (slug: string) => (focusedParts.has(slug) ? "var(--r-ink)" : "var(--r-ink-2)");
  /** Connectors are a KIND, not a state — the one legitimate viz spend on this page. */
  const connectorStroke = (slug: string) =>
    focusedParts.has(slug) ? "var(--r-ink)" : "var(--viz-4)";
  // Hovering LIGHTS, clicking OPENS — the same two-step the table's rows use, so the drawing is
  // not a separate interaction vocabulary you have to learn beside it.
  const hover = (slug: string) => ({
    onMouseEnter: () => onFocus({ kind: "part", id: slug }),
    onMouseLeave: () => onFocus(null),
    onClick: () => onInspect(slug),
    style: { cursor: "pointer" as const },
  });

  return (
    <div className="flex size-full min-h-0">
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
                const prose =
                  WORLD.profile.solids[part.slug as keyof typeof WORLD.profile.solids] ?? "";
                const title = (
                  <title>
                    {part.isVoid
                      ? `${part.slug} — ${prose}. Core Height is a formula, so this is drawn from what feeds it rather than from a literal. Dashed because it is a SUBTRACTION: declared volume with no material behind it.`
                      : `${part.slug} — ${prose}. Drawn true to the ${typeName} type's numbers; hovering it lights the parameters it consumes in the table.`}
                  </title>
                );
                /* THE ONE LEGAL DASH IN THIS DRAWING: a void must never read as material. */
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
                    <circle key={part.slug} cx={X(0)} cy={Y(0)} r={(part.w / 2) * SCALE} {...shared}>
                      {title}
                    </circle>
                  );
                return (
                  <rect key={part.slug} {...solidRect(part)} {...shared}>
                    {title}
                  </rect>
                );
              }

              const prose =
                WORLD.profile.connectors[part.slug as keyof typeof WORLD.profile.connectors] ?? "";
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

      <div className="min-w-0 flex-1 overflow-y-auto p-2">
        <p
          className="face-mono mb-1 t-caption text-[var(--r-ink-2)]"
          title="The profile's own constituent list. Hovering one lights both the shape and the table rows it drives, because there is only ever ONE thing in focus. Clicking OPENS it in the doc pane's lower half, where the half of it no parameter can drive — direction, system type, where its frame sits — is edited."
        >
          constituents · {typeName}
        </p>
        {CONSTITUENTS.map((part) => {
          const geom = GEOM_BY_SLUG.get(part.slug);
          const unbound =
            geom?.dims.filter(
              (dim) => boundParam(bindingOf(draft, part.slug, dim.property)) == null,
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
