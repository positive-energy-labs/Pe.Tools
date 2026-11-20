import { useContext } from "react";
import { RegistryContext } from "@effect/atom-react";
import {
  AttentionDocument,
  cite,
  leaveCitation,
  mention,
  sameRef,
  useAttention,
  type Ref,
} from "@pe/kit/lang/attention";
import { declutter, type Box } from "@pe/kit/lang/declutter";
import { SvgTip } from "@pe/kit/lang/tooltip";
import { token } from "@pe/kit/lib/token";
type Point = { x: number; y: number };
type Anchor = { at: Point; ghost?: string | null; drawn: boolean };
export type FootnoteProject = (ref: Ref) => Anchor | null;
const CHIP = 18;
const CHIP_BOX = CHIP + 4;
/** Footnotes clear one another and the anchor dots. */
export function placeChips<T extends Point>(
  anchors: readonly T[],
  size: { width: number; height: number },
  obstacles: readonly Box[] = [],
) {
  return declutter(
    anchors.map((a) => ({
      ...a,
      x: a.x - CHIP_BOX / 2,
      y: a.y - CHIP_BOX / 2 - 24,
      width: CHIP_BOX,
      height: CHIP_BOX,
    })),
    { x: 0, y: 0, ...size },
    [...obstacles, ...anchors.map((a) => ({ x: a.x - 4, y: a.y - 4, width: 8, height: 8 }))],
  );
}

const HIT = { pointerEvents: "auto", cursor: "pointer" } as const;
export function useFootnotes(
  project: FootnoteProject,
  size: { width: number; height: number },
  obstacles: readonly Box[] = [],
) {
  const doc = useContext(AttentionDocument) ?? "";
  const { citation: cited } = useAttention(doc);
  const anchors = (cited?.refs ?? [])
    .filter((ref) => ref.doc === doc)
    .flatMap((ref) => {
      const anchor = project(ref);
      return anchor ? [{ ...anchor, ref, ...anchor.at }] : [];
    });
  return {
    cited,
    chips: placeChips(anchors, size, obstacles).map((box) => ({
      ...box,
      box,
      chip: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    })),
  };
}
/** Projection is the only picture-specific seam. Citation and reference identity stay app-wide. */
export function Footnotes({
  project,
  size,
  obstacles,
  onGo,
}: {
  project: FootnoteProject;
  size: { width: number; height: number };
  obstacles?: readonly Box[];
  onGo?: (ref: Ref) => void;
}) {
  const registry = useContext(RegistryContext);
  const { cited, chips } = useFootnotes(project, size, obstacles);
  if (!cited) return null;
  return (
    <g data-footnotes="">
      {chips.map(({ ref, at, chip, ghost, drawn }) => {
        const active = cited.focus == null || sameRef(cited.focus, ref);
        return (
          <g
            key={`${ref.doc}/${ref.key}`}
            data-subject-badge={ref.key}
            data-footnote={ref.number}
            data-emphasized={active}
            opacity={active ? 1 : 0.35}
          >
            {ghost ? (
              <path
                d={ghost}
                fill="none"
                stroke={token("ink-2")}
                strokeWidth={3}
                strokeLinecap="round"
                className="dash-reference"
              />
            ) : !drawn ? (
              <circle
                cx={at.x}
                cy={at.y}
                r={6}
                fill="none"
                stroke={token("ink-2")}
                strokeWidth={2}
              />
            ) : null}
            {/* The leader: a cased ink line from the chip to a dot on the element. */}
            <line
              x1={chip.x}
              y1={chip.y}
              x2={at.x}
              y2={at.y}
              stroke={token("page")}
              strokeOpacity={0.75}
              strokeWidth={3.5}
            />
            <line
              x1={chip.x}
              y1={chip.y}
              x2={at.x}
              y2={at.y}
              stroke={token("ink")}
              strokeWidth={1.25}
            />
            <circle
              cx={at.x}
              cy={at.y}
              r={2.75}
              fill={token("ink")}
              stroke={token("page")}
              strokeWidth={1.5}
            />
            {/* The kit's subject mark: the same chip the text draws after the name, lit together.
                Hover lights its token in the text; a press goes to the subject, as the token does. */}
            <g
              className="subject-badge"
              data-lit={sameRef(cited.focus, ref) ? "" : undefined}
              transform={`translate(${chip.x} ${chip.y})`}
              style={HIT}
              {...mention(ref)}
              onMouseEnter={() =>
                cite(registry, { ...cited, focus: { doc: ref.doc, key: ref.key } })
              }
              onMouseLeave={() => {
                cite(registry, { ...cited, focus: null });
                leaveCitation(registry, cited.owner);
              }}
              onClick={() => onGo?.(ref)}
            >
              <SvgTip content={"? go"} />
              <circle r={CHIP / 2} />
              <text y={3.5} textAnchor="middle">
                {ref.number}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
