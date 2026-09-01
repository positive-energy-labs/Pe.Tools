import { token } from "#/lib/token";
/**
 * /family — the doc sidebar's contents: the spec in two modes, and pea's proposal cards.
 *
 * ONE PANE, TWO MODES. `text` is the spec as OCR read it — markdown blocks, checkable word for
 * word, which is what a citation actually resolves to. `sheet` is a STAND-IN for the grounded-doc
 * camera: it draws where the blocks sit on the page, not what they say, which is the one question
 * the text mode cannot answer. It announces itself as a stand-in rather than pretending.
 *
 * PROPOSALS DOCK ON TOP OF IT, so the verdict is always beside the spec text that justifies it —
 * the whole reason the table's rail and folds only ever LOCATE and never decide.
 */
import { EmptyState } from "#/components/lang/empty";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip, Tag } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Switcher } from "#/components/lang/switcher";
import { hashOf, type CellVerdict } from "#/family/model";
import type { ProtoProposal, ProtoSpec } from "#/family/world";

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
        <span className="face-mono t-caption min-w-0 flex-1 truncate text-ink-2">
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
                <pre className="mt-1 px-2 py-1.5">{block.md}</pre>
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
              <div className="face-mono t-caption mb-0.5 text-ink-2">page {page}</div>
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

export function ProposalCard({
  proposal,
  verdict,
  focused,
  blockMd,
  specFileName,
  onAccept,
  onDeny,
  onHover,
  register,
}: {
  proposal: ProtoProposal;
  /** Named so the citation line can say WHICH document it read from. */
  specFileName?: string | null;
  verdict: CellVerdict;
  focused: boolean;
  blockMd: string | null;
  onAccept: () => void;
  onDeny: () => void;
  onHover: (on: boolean) => void;
  register: (node: HTMLDivElement | null) => void;
}) {
  const target = proposal.typeName
    ? `${proposal.param} · ${proposal.typeName}`
    : `${proposal.param} · family value`;

  // A settled proposal collapses to one line rather than disappearing: the sidebar keeps the
  // record that a claim was made and answered, and the citation link stays hoverable.
  if (verdict !== "open") {
    const settled = {
      accepted: {
        mark: "✓",
        word: "accepted",
        colour: token("done"),
        note: `Accepted — the table now reads ${proposal.proposed} for ${target}. The proposal itself was never persisted; only the value it argued for is in the document, and its citation is still live.`,
      },
      denied: {
        mark: "—",
        word: "denied",
        colour: token("ink-mute"),
        note: `Denied — the profile keeps its own value for ${target}. Nothing was written, and the citation is unaffected: grounding is a fact about the spec, not about pea.`,
      },
      superseded: {
        mark: "—",
        word: "superseded by your edit",
        colour: token("ink-mute"),
        // MUTED, never `--pe-done`: nothing of pea's was adopted. Accepted and superseded look
        // different because they ARE different — one is agreement, the other is being overtaken.
        // The CELL shows nothing at all; the grammar has no `severed` stage.
        note: `Superseded — you typed your own value into ${target}, so pea's ${proposal.proposed} has nothing left to argue for. There was no accept and no deny; the cell simply moved on. The grounding citation is untouched, because where a number came from is a separate fact from what pea read.`,
      },
    }[verdict];
    return (
      <div
        ref={register}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        className="hairline-b face-mono flex items-baseline gap-1 py-0.5 t-caption last:border-b-0"
        title={settled.note}
        style={{ color: settled.colour }}
      >
        <span>{settled.mark}</span>
        <span className="truncate">{target}</span>
        <span className="ml-auto shrink-0 text-ink-2">{settled.word}</span>
      </div>
    );
  }

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
      title="A pea proposal — ephemeral and page-scoped. It is not in the document and never will be; accepting is what writes the value, and leaving the page throws the proposal away."
    >
      <div className="face-mono t-caption text-ink-2">{target}</div>
      <div className="face-mono t-label text-ink">
        {proposal.current ?? "—"} → {proposal.proposed}
      </div>
      <p className="mt-0.5 leading-snug text-ink">{proposal.note}</p>
      {blockMd && (
        <p
          className="hairline-l face-mono mt-1 max-h-[3lh] overflow-hidden pl-1.5 whitespace-pre-line t-caption text-ink-2"
          title={`Read from ${proposal.sourceBlockId} of ${specFileName ?? "the spec"} — the source text verbatim, so the claim is checkable without leaving the page.`}
        >
          {blockMd}
        </p>
      )}
      {/* Both verbs are page-scoped ACTS, and accept deliberately so: it STAGES the value into the
          draft, where the unsaved square then says the file has not moved. `accept` wears the
          AGENT tone because it adopts pea's reading; `deny` is an ordinary safe verb. Only
          `save profile` crosses out of the page, and it is not on this sidebar. */}
      <div className="mt-1 flex gap-1">
        <Verb
          label="accept"
          tone="agent"
          onClick={onAccept}
          reason={`Write ${proposal.proposed} into the table for ${target}. You will see it land in the cell — that IS the accept; the profile then reads unsaved until you save it.`}
        />
        <Verb
          label="deny"
          onClick={onDeny}
          reason="Throw the proposal away and keep the profile as authored. The card collapses to a struck line so the sidebar still records that it was answered."
        />
      </div>
    </div>
  );
}
