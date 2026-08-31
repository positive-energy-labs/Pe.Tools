import { token } from "#/lib/token";
import { EmptyState } from "#/components/lang/empty";
import type { Draft, Focus, PageWorld } from "#/family/model";
import {
  BOX,
  M,
  SCALE,
  VIEWS,
  buildParts,
  hoverProps,
  range,
  type Part,
} from "#/family/anatomy-model";

// ── the FIXTURE lane: the six known slugs, per-slug placement constants ─────────────────────────

export function FixtureViews({
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
      <div className="p-3">
        <EmptyState
          story="scope"
          exit="give Body Width and Body Height literal values at this type, or stage a type that has them"
        >
          no shape to draw — the body&apos;s width or height is not a literal at this type, and
          nothing here guesses
        </EmptyState>
      </div>
    );

  /** Every OTHER type's solids, as outlines at the same scale. */
  const ghosts = Object.keys(draft.types)
    .filter((name) => name !== typeName)
    .map((name) => ({ typeName: name, parts: buildParts(world, draft, name) }));

  const partFill = (slug: string) => (focusedParts.has(slug) ? token("select") : "transparent");
  const partStroke = (slug: string) => (focusedParts.has(slug) ? token("ink") : token("ink-2"));
  /** Connectors are a KIND, not a state — the one legitimate viz spend on this page. */
  const connectorStroke = (slug: string) =>
    focusedParts.has(slug) ? token("ink") : token("viz-4");
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
            className="h-full min-w-0 flex-1 border-r border-line last:border-r-0"
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
                stroke={token("line-2")}
                strokeWidth={0.5}
              />
            ) : (
              <>
                <line
                  x1={M}
                  y1={Y(0)}
                  x2={BOX - M}
                  y2={Y(0)}
                  stroke={token("line")}
                  strokeWidth={0.5}
                />
                <line
                  x1={X(0)}
                  y1={M}
                  x2={X(0)}
                  y2={BOX - M}
                  stroke={token("line")}
                  strokeWidth={0.5}
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
                    stroke: token("line-2"),
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
                      ? token("ink")
                      : token("line-2")
                    : partStroke(part.slug),
                  strokeWidth: 0.8,
                  className: part.isVoid ? "dash-void" : undefined,
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

            <text x={M} y={BOX - 5} fontSize={7} fill={token("ink-2")}>
              {view.label}
            </text>
          </svg>
        );
      })}
    </>
  );
}
