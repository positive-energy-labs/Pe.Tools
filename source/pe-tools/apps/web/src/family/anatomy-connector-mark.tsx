import type { ConnGeo } from "#/family/family-model";
import type { PageWorld } from "#/family/model";
import { NORMAL_RE, hoverProps, type Axis, type ViewDef } from "#/family/anatomy-model";

export function ConnectorMark({
  conn,
  view,
  focusedParts,
  world,
  X,
  Y,
  scale,
  connectorStroke,
  hover,
}: {
  conn: ConnGeo;
  view: ViewDef;
  focusedParts: Set<string>;
  world: PageWorld;
  X: (value: number) => number;
  Y: (value: number) => number;
  scale: number;
  connectorStroke: (slug: string) => string;
  hover: (slug: string) => ReturnType<typeof hoverProps>;
}) {
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
  const prose = world.source.profile.connectors[conn.slug] ?? `${conn.domain} · ${conn.shape}`;

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
          fill="transparent"
          data-selected={active ? "" : undefined}
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
          fill="transparent"
          data-selected={active ? "" : undefined}
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
        fill="transparent"
        data-selected={active ? "" : undefined}
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
      <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={stroke} strokeWidth={active ? 1.6 : 1} />
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
}
