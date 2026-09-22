import { difference } from "../world";
import { token } from "#/lib/token";
import { FactChip as Chip } from "#/components/lang/chip";
import { Press } from "#/components/lang/press";
import { Delta, PartialityChip, fmtSqft } from "./unknown";
import { RunStrip } from "./zone-card";
import { HeaderScores } from "./no-scores";
import type { RunBrowserModel } from "./model";

export function RunBrowserHeader({ model }: { model: RunBrowserModel }) {
  const {
    linkNote,
    board,
    partCur,
    partPrev,
    boardPrev,
    abCaveat,
    scoresCur,
    comparing,
    scoresPrev,
    prevId,
    baseline,
    prevMeta,
    setBaseline,
    underlay,
    setUnderlay,
    changedOnly,
    setChangedOnly,
    runs,
    curId,
    pickCur,
    pickBaseline,
  } = model;
  const hasOverlay = model.reportCur?.Zones.some((zone) => zone.Ink || zone.Seals || zone.Close);
  return (
    <header
      className="flex shrink-0 flex-col gap-1.5 px-4 py-2"
      style={{ borderColor: token("line-2") }}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="">runs</h1>
        {linkNote && (
          <span
            className=""
            style={{ color: token("caution") }}
            title="The URL's deep link could not be fully applied."
          >
            {linkNote}
          </span>
        )}
        {board && (
          <span className="">
            B: {board.solved}/{board.zones} solved · {board.acceptedRooms ?? "?"} accepted rooms /{" "}
            {board.errors} errors · {fmtSqft(board.acceptedSqft)} accepted ·{" "}
            {fmtSqft(board.heldSqft)} held
          </span>
        )}
        <PartialityChip part={partCur} prefix="B: " />
        <PartialityChip part={partPrev} prefix="A: " />
        {boardPrev && board && (
          <span className="">
            Δ vs A: <Delta value={board.solved - boardPrev.solved} /> solved ·{" "}
            <Delta value={difference(board.acceptedSqft, boardPrev.acceptedSqft)} suffix=" sf" /> ·{" "}
            <Delta
              value={difference(board.heldSqft, boardPrev.heldSqft)}
              goodWhenUp={false}
              suffix=" sf held"
            />
          </span>
        )}
        {abCaveat ? (
          <Chip tone="caution" title={abCaveat}>
            A/B pairing caveat
          </Chip>
        ) : null}
        <HeaderScores runId={curId} cur={scoresCur} prev={comparing ? scoresPrev : undefined} />
        <span className="ml-auto flex items-center gap-1.5">
          {prevId ? (
            <Chip
              tone="meta"
              title={
                baseline === "auto"
                  ? "Baseline (A) follows the current run's chronological predecessor. Clear it for a single-run sheet — the layout will not shift."
                  : "Explicitly picked baseline (A)."
              }
            >
              A: {prevMeta?.label ?? prevId.slice(0, 15)}
              {baseline === "auto" ? " · auto" : ""}
            </Chip>
          ) : null}
          {prevId ? (
            <Press
              type="button"
              tone="neutral"
              size="caption"
              onClick={() => setBaseline(null)}
              title="Clear the baseline — cards show the current run only, same footprint."
            >
              clear A
            </Press>
          ) : (
            <Press
              type="button"
              tone="neutral"
              size="caption"
              onClick={() => setBaseline("auto")}
              title="Restore the default baseline: the current run's chronological predecessor."
            >
              A: auto
            </Press>
          )}
          <Press
            type="button"
            tone="neutral"
            size="caption"
            state={underlay ? "selected" : "rest"}
            disabled={!hasOverlay}
            onClick={() => setUnderlay((u) => !u)}
            title={
              hasOverlay
                ? "Show/hide additional ink and closure layers. The registered plan remains visible."
                : "Raw slice evidence remains visible; this capture has no separate overlay layers."
            }
          >
            ink evidence
          </Press>
          <Press
            type="button"
            tone="neutral"
            size="caption"
            state={changedOnly && comparing ? "selected" : "rest"}
            onClick={() => setChangedOnly((c) => !c)}
            disabled={!comparing}
            title={
              comparing
                ? "Show only zones that materially changed between A and B (rooms moved, sf moved > 0.5, verdict flipped, or exists on one side only)."
                : "Needs a baseline — pick A first."
            }
          >
            changed only
          </Press>
        </span>
      </div>
      <RunStrip
        runs={runs ?? []}
        curId={curId}
        prevId={prevId}
        onPickCur={pickCur}
        onPickBaseline={pickBaseline}
      />
    </header>
  );
}
