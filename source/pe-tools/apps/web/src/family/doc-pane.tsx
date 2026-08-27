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
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Switcher } from "#/components/lang/switcher";
import { hashOf, type CellVerdict } from "#/family/model";
import type { ProtoProposal, ProtoSpec } from "#/family/world";
import { cn } from "#/lib/utils";

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
      <EmptyState story="scope" exit="parse a cut sheet to attach one" className="p-3">
        no spec attached — every number in the profile is asserted rather than sourced
      </EmptyState>
    );
  return (
    <div className="space-y-2 p-2">
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
            /* Lighting is a FILL and never a hue (SURFACE-PHILOSOPHY §5): `--r-select` is
               literally the ground ladder's selection rung, so the law is structural here. */
            className={cn(
              "rounded-[2px] border p-2",
              lit ? "border-line-2 bg-select" : "border-line",
            )}
          >
            <div className="face-mono flex items-baseline justify-between t-caption text-ink-2">
              <span>
                {block.id} · p{block.page}
              </span>
              <span>{block.kind}</span>
            </div>
            <pre className="mt-1 whitespace-pre-wrap break-words font-sans t-caption leading-snug text-ink">
              {block.md}
            </pre>
          </div>
        );
      })}
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
      <EmptyState story="scope" exit="parse a cut sheet to attach one" className="p-3">
        no spec attached to render — there are no block placements to draw
      </EmptyState>
    );

  const pages = [...new Set(spec.blocks.map((block) => block.page))].sort((a, b) => a - b);

  return (
    <div className="p-2">
      <div className="mb-2 flex items-center gap-1">
        {/* A stand-in announces itself AND says what would replace it (SURFACE-PHILOSOPHY §3).
            An advisory, not a warning: it blocks nothing and claims nothing about the model. */}
        <OutcomeLine
          className="flex-1"
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

      <div className="space-y-3 overflow-x-auto">
        {pages.map((page) => {
          const blocks = spec.blocks.filter((block) => block.page === page);
          return (
            <div key={page} style={{ width: `${100 * zoom}%`, minWidth: 180 }}>
              <div className="face-mono mb-0.5 t-caption text-ink-2">page {page}</div>
              <svg
                viewBox="0 0 100 130"
                className="block w-full border border-line-2 bg-page"
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
                        fill={lit ? "var(--r-select)" : "transparent"}
                        /* A neutral mark, not a hue: a fill cannot separate at this size, so
                           the highest-contrast neutral is what lights it (takeoffs #8). */
                        stroke={lit ? "var(--r-ink)" : "var(--r-line-2)"}
                        strokeWidth={lit ? 1 : 0.4}
                      >
                        <title>
                          {lit
                            ? `${block.id} — cited by the parameter in focus. This is roughly where it sits on page ${page}.`
                            : `${block.id} · ${block.kind} on page ${page}. Hover a grounded row in the table to light it.`}
                        </title>
                      </rect>
                      {lit && (
                        <text
                          x={x}
                          y={y - 1.5}
                          fontSize={4}
                          fill="var(--r-ink-2)"
                          style={{ fontFamily: "ui-monospace, monospace" }}
                        >
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
        colour: "var(--r-done)",
        note: `Accepted — the table now reads ${proposal.proposed} for ${target}. The proposal itself was never persisted; only the value it argued for is in the document, and its citation is still live.`,
      },
      denied: {
        mark: "—",
        word: "denied",
        colour: "var(--r-ink-mute)",
        note: `Denied — the profile keeps its own value for ${target}. Nothing was written, and the citation is unaffected: grounding is a fact about the spec, not about pea.`,
      },
      superseded: {
        mark: "—",
        word: "superseded by your edit",
        colour: "var(--r-ink-mute)",
        // MUTED, never `--r-done`: nothing of pea's was adopted. Accepted and superseded look
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
        className="face-mono flex items-baseline gap-1 py-0.5 t-caption"
        title={settled.note}
        style={{ color: settled.colour }}
      >
        <span>{settled.mark}</span>
        <span className="truncate">{target}</span>
        <span className="ml-auto shrink-0 opacity-70">{settled.word}</span>
      </div>
    );
  }

  return (
    <div
      ref={register}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="mb-1.5 py-1 pl-2"
      /* Pea's identity, never the commit colour: the card edge is a MARK (`--r-pea`, the display
         rung) and the focus wash is mixed from pea's ink. */
      style={{
        borderLeft: "1.5px solid var(--r-pea)",
        background: focused
          ? "color-mix(in srgb, var(--r-pea-ink) 12%, transparent)"
          : "transparent",
        transition: "background 0.25s",
      }}
      title="A pea proposal — ephemeral and page-scoped. It is not in the document and never will be; accepting is what writes the value, and leaving the page throws the proposal away."
    >
      <div className="face-mono t-caption text-ink-2">{target}</div>
      <div className="face-mono t-label text-pea-ink">
        {proposal.current ?? "—"} → {proposal.proposed}
      </div>
      <p className="mt-0.5 t-caption leading-snug text-ink">{proposal.note}</p>
      {blockMd && (
        <p
          className="face-mono mt-1 line-clamp-3 whitespace-pre-line t-caption leading-snug text-ink-2"
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
