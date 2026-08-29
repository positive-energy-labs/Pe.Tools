import { useMemo } from "react";
import { Key } from "#/anatomy";
import { FactChip } from "#/components/lang/chip";
import { fmtNum } from "#/components/master-table/model";
import { token } from "#/lib/token";
import { contentViewport, fitFrame, type Bounds2, unionBounds } from "#/lib/affine-frame";
import { loopBounds, pathD } from "#/takeoff/model";
import { ABSENT_INK, CURSOR_INK, STATE_META, stateInk, type RoomState } from "#/takeoff/room-state";
import type { WorldRoom, WorldZone } from "#/takeoff/world";

export function ZonePeek({
  zone,
  cursorRoom,
  geoReady,
  stateOf,
}: {
  zone: WorldZone;
  cursorRoom: WorldRoom | null;
  geoReady: boolean;
  stateOf: (room: WorldRoom) => RoomState;
}) {
  const withGeometry = zone.rooms.filter((r) => r.outer !== null);
  const bounds = useMemo<Bounds2>(() => {
    let b: Bounds2 = zone.zone.bounds;
    for (const room of zone.rooms) if (room.outer) b = unionBounds(b, loopBounds([room.outer]));
    for (const residue of zone.residues) b = unionBounds(b, loopBounds([residue.outer]));
    return b;
  }, [zone]);

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-6);
  const font = span / 26;
  const { viewport, padding } = contentViewport(bounds, 0.06);
  const frame = fitFrame(bounds, viewport, { padding, yAxis: "up" });
  const [cursorX, cursorY] = cursorRoom ? frame.toViewport(cursorRoom.label) : [0, 0];

  return (
    <div>
      <div className="h-52 border-b border-line bg-artifact">
        <svg
          viewBox={`0 0 ${viewport.width} ${viewport.height}`}
          preserveAspectRatio="xMidYMid meet"
          className="size-full"
        >
          <title>{`${zone.zone.key} — declared zone, its rooms, and the cursor room`}</title>

          <path
            d={pathD(zone.zone.loops, frame)}
            fillRule="evenodd"
            fill={`color-mix(in srgb, rgb(${zone.zone.color}) 8%, transparent)`}
            stroke={`rgb(${zone.zone.color})`}
            strokeWidth={1.5}
            strokeOpacity={0.85}
            vectorEffect="non-scaling-stroke"
          />

          {zone.residues.map((residue) => (
            <path
              key={residue.id}
              d={pathD([residue.outer, ...residue.holes], frame)}
              fillRule="evenodd"
              fill={`color-mix(in srgb, ${ABSENT_INK} 12%, transparent)`}
              stroke={ABSENT_INK}
              strokeOpacity={0.4}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              className="dash-seam"
            >
              <title>{`held residue · ${residue.reason} · ${fmtNum(residue.rawSqft, 0)} sf`}</title>
            </path>
          ))}

          {zone.rooms.map((room) => {
            const on = cursorRoom?.guid === room.guid;
            const state = stateOf(room);
            const accent = on ? CURSOR_INK : stateInk(state);
            const [labelX, labelY] = frame.toViewport(room.label);
            if (!room.outer) {
              const r = Math.max(Math.sqrt(Math.max(room.sqft, 20)) / 3.2, span / 90);
              return (
                <circle
                  key={room.guid}
                  cx={labelX}
                  cy={labelY}
                  r={r}
                  fill={`color-mix(in srgb, ${accent} ${on ? 45 : 18}%, transparent)`}
                  stroke={accent}
                  strokeWidth={on ? 2 : 1}
                  vectorEffect="non-scaling-stroke"
                  className="dash-seam"
                >
                  <title>{`${room.name} · ${fmtNum(room.sqft, 0)} sf · position only, no boundary`}</title>
                </circle>
              );
            }
            return (
              <path
                key={room.guid}
                d={pathD([room.outer, ...room.holes], frame)}
                fillRule="evenodd"
                fill={`color-mix(in srgb, ${accent} ${on ? 32 : 10}%, transparent)`}
                stroke={accent}
                strokeOpacity={on ? 0.95 : 0.55}
                strokeWidth={on ? 2 : state === "call" ? 1.75 : 1}
                vectorEffect="non-scaling-stroke"
              >
                <title>{`${room.name} · ${fmtNum(room.sqft, 0)} sf · ${STATE_META[state].label}`}</title>
              </path>
            );
          })}

          {cursorRoom && (
            <text
              x={cursorX}
              y={cursorY}
              textAnchor="middle"
              fontSize={font}
              className="pointer-events-none select-none"
              fill={token("ink")}
            >
              <tspan x={cursorX} fontWeight="var(--weight-strong)">
                {cursorRoom.name}
              </tspan>
              <tspan x={cursorX} dy={font * 1.15} fillOpacity={0.7}>
                {fmtNum(cursorRoom.sqft, 0)} sf
              </tspan>
            </text>
          )}
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-2.5 py-1">
        <Key tone={CURSOR_INK} label="cursor room" />
        <Key tone={stateInk("call")} label="needs a call" />
        {zone.residues.length > 0 && (
          <Key tone={ABSENT_INK} label={`held ×${zone.residues.length}`} seam />
        )}
        <span className="face-mono t-value text-ink-2">
          {withGeometry.length}/{zone.rooms.length} with real boundaries
        </span>
      </div>

      {(!geoReady || withGeometry.length < zone.rooms.length) && (
        <p className="px-2.5 pb-1.5">
          <FactChip
            dashed
            title="Some rooms here are drawn as position dots rather than boundaries. A dot says the position is known and the shape is not — it is a stand-in, never a measurement."
          >
            {!geoReady
              ? "detector fixture still loading · rooms are position dots"
              : "outside the replayed capture · label points, no boundaries"}
          </FactChip>
        </p>
      )}
    </div>
  );
}
