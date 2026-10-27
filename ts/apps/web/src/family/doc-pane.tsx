import type { CellLike } from "@pe/agent-contracts";
import { token } from "@pe/kit/lib/token";
import { EmptyState } from "@pe/kit/lang/empty";
import { ArtifactFrame } from "@pe/kit/lang/artifact-frame";
import { FactChip, Tag } from "@pe/kit/lang/chip";
import { useEffect, useRef } from "react";
import { useGroundedDoc } from "#/grounded-doc/engine";
import { PagePane } from "#/grounded-doc/view/page-pane";
import { ReviewRow, type CellWire } from "#/components/work/band";
import { Switcher } from "@pe/kit/lang/switcher";

import type { ProtoProposal, ProtoSpec } from "#/family/world";
import { Code } from "@pe/kit/lang/code";
import { TooltipHint } from "@pe/kit/lang/tooltip";

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
      <div className="hairline-b flex items-center gap-2 px-2 py-1">
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
            <TooltipHint
              content={
                lit
                  ? "This is the block the focused parameter is grounded in. That correspondence is the whole claim — if the text does not say what the cell says, the cell is wrong."
                  : `Page ${block.page} of ${spec.fileName}, as OCR read it. Hover a grounded row in the table to light the block it cites.`
              }
              key={block.id}
            >
              <div>
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
            </TooltipHint>
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
  reveal = null,
  zoom,
  onZoom,
}: {
  spec: ProtoSpec | null;
  litBlocks: Set<string>;
  /** The last explicit locate: the only thing that scrolls the sheet (N1). Hover only lights. */
  reveal?: { block: string; n: number } | null;
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
  }, [blockId, engine.doc, engine.hoverBlock]);
  useEffect(() => {
    const node = reveal ? refs.current.get(reveal.block) : null;
    const pane = viewport.current;
    if (node && pane)
      pane.scrollTop += node.getBoundingClientRect().top - pane.getBoundingClientRect().top;
  }, [reveal, engine.doc]);
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
 * One pea suggestion beside the spec text that justifies it. Its verbs are the cell's own: the card
 * draws the same Work field as a `ReviewRow`, so accepting here is the table cell's accept.
 */
export function ProposalCard({
  suggestion,
  wire,
  cell,
  focused,
  blockMd,
  specFileName,
  onHover,
  register,
}: {
  suggestion: ProtoProposal;
  wire: CellWire;
  /** The Work field the suggestion stands on. */
  cell: CellLike;
  /** Named so the citation line can say WHICH document it read from. */
  specFileName?: string | null;
  focused: boolean;
  blockMd: string | null;
  onHover: (on: boolean) => void;
  register: (node: HTMLDivElement | null) => void;
}) {
  const target = suggestion.constituent
    ? `${suggestion.constituent.section} · ${suggestion.constituent.slug}${
        suggestion.constituent.property ? ` · ${suggestion.constituent.property}` : ""
      }`
    : suggestion.property
      ? `${suggestion.param} · ${suggestion.property}`
      : suggestion.typeName
        ? `${suggestion.param} · ${suggestion.typeName}`
        : `${suggestion.param} · family value`;
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
      data-suggestion-id={suggestion.id}
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
        address={suggestion.id}
        label={<span className="t-small face-mono text-ink-2">{target}</span>}
        cell={cell}
        // The note is the card's paragraph below; the cell keeps its facts on hover.
        facts={{
          value: suggestion.proposed,
          ...(suggestion.current != null ? { currentValue: suggestion.current } : {}),
          foot: "hover",
        }}
        mark={false}
      />
      <p className="mt-0.5 text-ink">{suggestion.note}</p>
      {blockMd && (
        <TooltipHint
          content={`Read from ${suggestion.sourceBlockId} of ${specFileName ?? "the spec"} — the source text verbatim, so the claim is checkable without leaving the page.`}
        >
          <p className="hairline-l mt-1 max-h-[3lh] overflow-hidden pl-1.5 whitespace-pre-line t-small face-mono text-ink-2">
            {blockMd}
          </p>
        </TooltipHint>
      )}
    </div>
  );
}
