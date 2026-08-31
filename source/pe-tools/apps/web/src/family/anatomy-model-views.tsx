import { useMemo } from "react";
import { token } from "#/lib/token";
import { EmptyState } from "#/components/lang/empty";
import {
  buildSheet,
  sheetBounds,
  type ConnGeo,
  type FamilyModel,
  type SolidGeo,
} from "#/family/family-model";
import type { Draft, Focus, PageWorld } from "#/family/model";
import { draftedModel } from "#/family/project";
import { AXES, BOX, M, VIEWS, type Axis, hoverProps } from "#/family/anatomy-model";
import { ConnectorMark } from "#/family/anatomy-connector-mark";

// ── the LIVE lane: whatever document is open, through the real evaluator ───────────────────────

export function ModelViews({
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
      <div className="p-3">
        <EmptyState
          story="scope"
          exit="give the document's solids values that resolve to numbers at this type, or stage a type where they do"
        >
          no shape to draw — no solid&apos;s dimensions resolve to numbers at this type, and nothing
          here guesses
        </EmptyState>
      </div>
    );

  // ONE scale for all three views, from the bounds INCLUDING ghosts — so it does not move when a
  // different type takes the stage, and a taller type draws taller.
  const span = Math.max(...AXES.map((axis) => bounds[axis][1] - bounds[axis][0]));
  const scale = (BOX - 2 * M) / span;

  const partFill = (slug: string) => (focusedParts.has(slug) ? token("select") : "transparent");
  const partStroke = (slug: string) => (focusedParts.has(slug) ? token("ink") : token("ink-2"));
  const connectorStroke = (slug: string) =>
    focusedParts.has(slug) ? token("ink") : token("viz-4");
  const hover = (slug: string) => hoverProps(slug, onFocus, onInspect);

  /** What the drawing cannot place, said in words below it rather than drawn at a guess. */
  const unplottablePlanes = sheet.planes.filter(
    (plane) => plane.axis == null || plane.offset == null,
  );
  const partialSolids = sheet.solids.filter(
    (geo) => geo.w == null || geo.d == null || geo.h == null,
  );

  return (
    <div className="flex min-w-0 flex-1 flex-col">
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

          const connMark = (conn: ConnGeo) => (
            <ConnectorMark
              key={conn.slug}
              conn={conn}
              view={view}
              focusedParts={focusedParts}
              world={world}
              X={X}
              Y={Y}
              scale={scale}
              partFill={partFill}
              connectorStroke={connectorStroke}
              hover={hover}
            />
          );

          return (
            <svg
              key={view.key}
              viewBox={`0 0 ${BOX} ${BOX}`}
              className="face-mono h-full min-w-0 flex-1 border-r border-line bg-artifact last:border-r-0"
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

              {/* ghost outlines — non-interactive, so they never steal a hover */}
              {sheet.ghosts.map((ghost) =>
                ghost.solids
                  .filter((geo) => !geo.isVoid)
                  .map((geo) => {
                    const shared = {
                      fill: "none",
                      stroke: token("line-2"),
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
                      ? token("ink")
                      : token("line-2")
                    : partStroke(geo.slug),
                  strokeWidth: 0.8,
                  className: geo.isVoid ? "dash-void" : undefined,
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
                const stroke = lit ? token("ink") : token("line-2");
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
                      fill={lit ? token("ink") : token("ink-2")}
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
                  <g key={frame.slug} stroke={token("ink-2")} strokeWidth={0.6}>
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
                    stroke={token("viz-5")}
                    strokeWidth={0.8}
                  />
                  <circle
                    cx={X(sheet.rcp[view.u] as number)}
                    cy={Y(sheet.rcp[view.v] as number)}
                    r={2.5}
                    fill={token("viz-5")}
                  />
                </g>
              )}

              <text
                x={M}
                y={BOX - 5}
                fontSize={7}
                fill={token("ink-2")}
                style={{ letterSpacing: "0.08em" }}
              >
                {view.label.toUpperCase()}
              </text>
            </svg>
          );
        })}
      </div>

      {(unplottablePlanes.length > 0 || partialSolids.length > 0) && (
        <div className="px-2 py-1">
          {partialSolids.map((geo) => (
            <p key={geo.slug}>
              ─ ─ solid {geo.slug} · {world.source.profile.solids[geo.slug] ?? geo.kind}{" "}
              <span>
                (a dimension does not resolve to a number at this type — named rather than drawn at
                a guess)
              </span>
            </p>
          ))}
          {unplottablePlanes.map((plane) => (
            <p key={plane.slug}>
              ─ ─ plane {plane.slug} · {plane.text}{" "}
              <span>
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
