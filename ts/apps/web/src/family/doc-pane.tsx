import type { TrichotomyCellLike } from "@pe/agent-contracts";
import { token } from "#/lib/token";
import { EmptyState } from "#/components/lang/empty";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip, Tag } from "#/components/lang/chip";
import { useEffect, useRef } from "react";
import { useGroundedDoc } from "#/grounded-doc/engine";
import { PagePane } from "#/grounded-doc/view/page-pane";
import { ReviewRow, type CellWire } from "#/components/lang/band";
import { Switcher } from "#/components/lang/switcher";

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

/** The same measured page canvas as /doc-lab, driven by the family's citation focus. */
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
  const engine = useGroundedDoc();
  const refs = useRef(new Map<string, HTMLElement>());
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (spec) engine.setDoc(spec);
    else engine.clear();
  }, [spec, engine.setDoc, engine.clear]);
  const blockId = [...litBlocks][0] ?? null;
  useEffect(() => {
    engine.hoverBlock(blockId, "external");
    const node = blockId ? refs.current.get(blockId) : null;
    const pane = viewport.current;
    if (node && pane)
      pane.scrollTop += node.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  }, [blockId, litBlocks, engine.doc, engine.hoverBlock]);
  if (!spec)
    return (
      <EmptyState story="scope" exit="attach a cut sheet">
        no spec attached
      </EmptyState>
    );
  return (
    <div ref={viewport} className="h-full p-1.5 overflow-auto">
      <Switcher
        ariaLabel="page zoom"
        value={zoom === 1 ? "fit" : "in"}
        onChange={(next) => onZoom(next === "fit" ? 1 : 1.6)}
        options={[
          { value: "fit", label: "fit", title: "Fit the page" },
          { value: "in", label: "1.6x", title: "Zoom into the page" },
        ]}
      />
      <div style={{ width: `${100 * zoom}%` }}>
        <PagePane engine={engine} refs={refs} litBlockIds={litBlocks} />
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
    ? `${proposal.constituent.section} · ${proposal.constituent.slug}${
        proposal.constituent.property ? ` · ${proposal.constituent.property}` : ""
      }`
    : proposal.property
      ? `${proposal.param} · ${proposal.property}`
      : proposal.typeName
        ? `${proposal.param} · ${proposal.typeName}`
        : `${proposal.param} · family value`;
  return (
    <div
      ref={register}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) onHover(false);
      }}
      onFocus={() => onHover(true)}
      onBlur={(event) => {
        if (!event.relatedTarget && event.currentTarget.contains(document.activeElement)) return;
        if (!event.currentTarget.contains(event.relatedTarget)) onHover(false);
      }}
      tabIndex={0}
      data-proposal-id={proposal.id}
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
