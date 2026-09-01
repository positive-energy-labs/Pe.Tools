import { token } from "#/lib/token";
/**
 * /family — the doc sidebar's contents: the spec in two modes, and pea's proposal cards.
 *
 * ONE PANE, TWO MODES. `text` is the spec as OCR read it — markdown blocks, checkable word for
 * word, which is what a citation actually resolves to. `sheet` is a STAND-IN for the grounded-doc
 * camera: it draws where the blocks sit on the page, not what they say, which is the one question
 * the text mode cannot answer. It announces itself as a stand-in rather than pretending.
 *
 * PROPOSALS DOCK ON TOP OF IT, so the decision is always beside the spec text that justifies it —
 * the whole reason the table's rail and folds only ever LOCATE and never decide.
 */
import { EmptyState } from "#/components/lang/empty";
import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { FactChip, Tag } from "#/components/lang/chip";
import { OutcomeLine } from "#/components/lang/outcome";
import { Verb } from "#/components/lang/verb";
import { Switcher } from "#/components/lang/switcher";
import { hashOf } from "#/family/model";
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
  state,
  focused,
  blockMd,
  specFileName,
  onAccept,
  onDeny,
  onReopen,
  onHover,
  register,
}: {
  proposal: ProtoProposal;
  /** Named so the citation line can say WHICH document it read from. */
  specFileName?: string | null;
  /** The proposal's place in the ONE lifecycle, derived from the draft by `proposalState`. */
  state: "open" | "taken" | "cleared";
  focused: boolean;
  blockMd: string | null;
  onAccept: () => void;
  onDeny: () => void;
  onReopen: () => void;
  onHover: (on: boolean) => void;
  register: (node: HTMLDivElement | null) => void;
}) {
  const target = proposal.typeName
    ? `${proposal.param} · ${proposal.typeName}`
    : `${proposal.param} · family value`;

  // A settled proposal collapses to one line rather than disappearing: the sidebar keeps the
  // record that a claim was made and answered, and the citation link stays hoverable. TWO
  // outcomes, not four — `accepted`, `denied` and `superseded` were three names for two facts.
  if (state !== "open") {
    const settled =
      state === "taken"
        ? {
            mark: "✓",
            word: "accepted · staged",
            colour: token("done"),
            note: `Accepted — the draft now stages ${proposal.proposed} for ${target}, and the cell wears PEA's square because the staged value is the one pea argued for. The proposal was never persisted; only the value it argued for is in the draft, and its citation is still live. Saving is what writes it.`,
          }
        : {
            mark: "—",
            word: "cleared",
            colour: token("ink-mute"),
            // MUTED, never `--pe-done`: nothing of pea's was adopted. Denying and being beaten to
            // the cell are ONE outcome — the proposal is gone and the cell shows the real value.
            note: `Cleared — either you denied it or you typed your own value into ${target} first. Pea's ${proposal.proposed} no longer stands, the cell shows the real value again, and nothing was written. The grounding citation is untouched, because where a number came from is a separate fact from what pea read. Re-open puts the proposal back.`,
          };
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
        {state === "cleared" && (
          <Verb
            label="re-open"
            onClick={onReopen}
            reason={`Put pea's reading of ${target} back on the table. Clearing it was page state, not a decision written anywhere, so this is a plain undo — the cell wears its fold again and accept and deny come back.`}
          />
        )}
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
      <div className="t-label text-ink">
        {proposal.current ?? "—"} → {proposal.proposed}
      </div>
      <p className="mt-0.5 text-ink">{proposal.note}</p>
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
          reason="Clear the proposal. It stops standing, the cell goes back to showing the profile's real value and draws nothing, and the profile is unchanged. The card collapses to one line carrying a re-open verb, so the sidebar still records that it was answered and the denial is undoable."
        />
      </div>
    </div>
  );
}
