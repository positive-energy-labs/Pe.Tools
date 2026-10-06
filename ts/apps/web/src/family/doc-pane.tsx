import type { TrichotomyCellLike } from "@pe/agent-contracts";
import { token } from "#/lib/token";
/**
 * /family — the doc sidebar's contents: the spec in two modes, and pea's proposal cards.
 *
 * ONE PANE, TWO MODES. `text` is the spec as OCR read it — markdown blocks, checkable word for
 * word, which is what a citation actually resolves to. `sheet` is a STAND-IN for the grounded-doc
 * camera: it draws where the blocks sit on the page, not what they say, which is the one question
 * the text mode cannot answer. It announces itself as a stand-in rather than pretending.
 *
 * PROPOSALS DOCK ON TOP OF IT, so a proposal's cell and its verbs sit beside the spec text that
 * justifies it.
 */
import { EmptyState } from "#/components/lang/empty";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip, Tag } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { ReviewRow, type CellWire } from "#/components/lang/band";
import { Switcher } from "#/components/lang/switcher";
import { hashOf } from "#/family/model";
import type { ProtoProposal, ProtoSpec } from "#/family/world";
import { Code } from "#/components/lang/code";

export function SpecText({
  spec,
  litBlocks,
}: {
  /** The open document's spec, THREADED rather than imported: on the live lane there is not one
   * yet, and a pane that kept rendering the fixture's cut sheet would be citing another family. */
  spec: ProtoSpec | null;
  litBlocks: Set<string>;
}) {
  if (!spec)
    return (
      <EmptyState story="scope" exit="parse a cut sheet to attach one">
        no spec attached — every number in the profile is asserted rather than sourced
      </EmptyState>
    );
  return (
    <div>
      <div className="hairline-b flex items-center gap-2 px-2 py-1" data-surface="recess">
        <Tag>source</Tag>
        <span className="t-small face-mono min-w-0 flex-1 truncate text-ink-2">
          {spec.fileName}
        </span>
        <Tag>{spec.blocks.length} blocks</Tag>
      </div>
      <div className="space-y-1.5 p-1.5">
        {spec.blocks.map((block) => {
          const lit = litBlocks.has(block.id);
          return (
            <div
              key={block.id}
              title={
                lit
                  ? "This is the block the focused parameter is grounded in. That correspondence is the whole claim — if the text does not say what the cell says, the cell is wrong."
                  : `Page ${block.page} of ${spec.fileName}, as OCR read it. Hover a grounded row in the table to light the block it cites.`
              }
            >
              <ArtifactFrame
                head={
                  <>
                    <Tag>
                      {block.id} · p{block.page}
                    </Tag>
                    <Tag>{block.kind}</Tag>
                    {lit ? (
                      <FactChip title="The focused parameter cites this block.">
                        focused citation
                      </FactChip>
                    ) : null}
                  </>
                }
              >
                <Code code={block.md} lang="markdown" />
              </ArtifactFrame>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The sheet mode. Positions are hashed from the block id, so they are arbitrary but STABLE; a
 * stand-in that moved between renders would be worse than nothing.
 */
export function SpecSheet({
  spec,
  litBlocks,
  zoom,
  onZoom,
}: {
  spec: ProtoSpec | null;
  litBlocks: Set<string>;
  zoom: number;
  onZoom: (zoom: number) => void;
}) {
  if (!spec)
    return (
      <EmptyState story="scope" exit="parse a cut sheet to attach one">
        no spec attached to render — there are no block placements to draw
      </EmptyState>
    );

  const pages = [...new Set(spec.blocks.map((block) => block.page))].sort((a, b) => a - b);

  return (
    <div className="p-1.5">
      <div className="mb-1.5 flex items-center gap-1">
        {/* A stand-in announces itself AND says what would replace it (SURFACE-PHILOSOPHY §3).
            An advisory, not a warning: it blocks nothing and claims nothing about the model. */}
        <OutcomeLine
          kind="advisory"
          label="stand-in for the page camera"
          says="block placement only — the real surface renders the PDF here through the grounded-doc camera, at which point these outlines become the real text"
        />
        {/* An exclusive choice among a fixed set is a MODE, so it wears the mode treatment (a
            neutral fill) rather than becoming two verbs that both look pressable. */}
        <Switcher
          ariaLabel="page zoom"
          value={zoom === 1 ? "fit" : "in"}
          onChange={(next) => onZoom(next === "fit" ? 1 : 1.6)}
          options={[
            {
              value: "fit",
              label: "fit",
              title: "Fit the whole page in the sidebar — the view for locating a citation.",
            },
            {
              value: "in",
              label: "1.6×",
              title:
                "Zoom in. The sidebar scrolls; the highlighted block stays highlighted, so zooming never loses the thing you were looking at.",
            },
          ]}
        />
      </div>

      <div className="space-y-2.5 overflow-x-auto">
        {pages.map((page) => {
          const blocks = spec.blocks.filter((block) => block.page === page);
          return (
            <div key={page} style={{ width: `${100 * zoom}%`, minWidth: 180 }}>
              <div className="t-small face-mono mb-0.5 text-ink-2">page {page}</div>
              <svg
                viewBox="0 0 100 130"
                className="hairline-x-2 hairline-y-2 block w-full"
                data-surface="document"
                role="img"
                aria-label={`stand-in page ${page}`}
              >
                {blocks.map((block, index) => {
                  const hash = hashOf(block.id);
                  const x = 8 + (hash % 18);
                  const y = 12 + index * 34;
                  const width = Math.min(84 - (x - 8), 42 + ((hash >>> 7) % 40));
                  const height = block.kind === "table" ? 24 : block.kind === "heading" ? 7 : 14;
                  const lit = litBlocks.has(block.id);
                  return (
                    <g key={block.id}>
                      <rect
                        x={x}
                        y={y}
                        width={width}
                        height={height}
                        fill="transparent"
                        data-selected={lit ? "" : undefined}
                        /* A neutral mark, not a hue: a fill cannot separate at this size, so
                           the highest-contrast neutral is what lights it (takeoffs #8). */
                        stroke={lit ? token("ink") : token("line-2")}
                        strokeWidth={lit ? 1 : 0.4}
                      >
                        <title>
                          {lit
                            ? `${block.id} — cited by the parameter in focus. This is roughly where it sits on page ${page}.`
                            : `${block.id} · ${block.kind} on page ${page}. Hover a grounded row in the table to light it.`}
                        </title>
                      </rect>
                      {lit && (
                        <text x={x} y={y - 1.5} fontSize={4} fill={token("ink-2")}>
                          {block.id}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * One pea proposal beside the spec text that justifies it. Its verbs are the cell's own: the card
 * draws the same Work field as a `ReviewRow`, so accepting here is the table cell's accept.
 */
export function ProposalCard({
  proposal,
  wire,
  cell,
  focused,
  blockMd,
  specFileName,
  onHover,
  register,
}: {
  proposal: ProtoProposal;
  wire: CellWire;
  /** The Work field the proposal stands on. */
  cell: TrichotomyCellLike;
  /** Named so the citation line can say WHICH document it read from. */
  specFileName?: string | null;
  focused: boolean;
  blockMd: string | null;
  onHover: (on: boolean) => void;
  register: (node: HTMLDivElement | null) => void;
}) {
  const target = proposal.constituent
    ? `${proposal.constituent.section} · ${proposal.constituent.slug}`
    : proposal.typeName
      ? `${proposal.param} · ${proposal.typeName}`
      : `${proposal.param} · family value`;
  return (
    <div
      ref={register}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="hairline-b mb-1 py-1 pl-2 last:mb-0 last:border-b-0"
      /* Pea's identity, never the commit colour: the card edge is a MARK (`--pe-pea`, the display
         rung) and the focus wash is mixed from pea's ink. */
      style={{
        borderLeft: `1.5px solid ${token("pea")}`,
        backgroundColor: focused
          ? `color-mix(in srgb, ${token("pea-ink")} 12%, transparent)`
          : "transparent",
        transition: "background var(--motion-control)",
      }}
    >
      <ReviewRow
        wire={wire}
        address={proposal.id}
        label={<span className="t-small face-mono text-ink-2">{target}</span>}
        cell={cell}
        // The note is the card's paragraph below; the cell keeps its facts on hover.
        facts={{
          value: proposal.proposed,
          ...(proposal.current != null ? { currentValue: proposal.current } : {}),
          foot: "hover",
        }}
        mark={false}
      />
      <p className="mt-0.5 text-ink">{proposal.note}</p>
      {blockMd && (
        <p
          className="hairline-l mt-1 max-h-[3lh] overflow-hidden pl-1.5 whitespace-pre-line t-small face-mono text-ink-2"
          title={`Read from ${proposal.sourceBlockId} of ${specFileName ?? "the spec"} — the source text verbatim, so the claim is checkable without leaving the page.`}
        >
          {blockMd}
        </p>
      )}
    </div>
  );
}
