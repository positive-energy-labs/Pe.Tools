import { token } from "#/lib/token";
import { FactChip as Chip } from "#/components/lang/chip";
import { itemKey, type StagedItem } from "./feedback/staging";
import { type RunIndexEntry, type ZoneRecord } from "./world";
import { Press } from "#/components/lang/press";
import { Delta, adaptedKnobs, fmtTime, partialTitle, zoneShort } from "./browser-unknown-title";
import { ZonePanel } from "./browser-zone-panel";
import { MissingPanel, STAT_ROWS, StageButton } from "./browser-missing-panel";
import { PressContent } from "#/components/anatomy/press-content";

export function ZoneCard(props: {
  name: string;
  a: ZoneRecord | null;
  b: ZoneRecord | null;
  /** How the A side was matched: "key" = stable zone identity (report v4); "name" = positional
   * ordinal fallback for pre-key packages — surfaced as a caveat because it can silently compare
   * different geography (SHIMS.md #2). */
  pairedBy: "key" | "name";
  runA: string | null;
  runB: string;
  panelFullW: number;
  panelHalfW: number;
  panelH: number;
  underlay: boolean;
  highlighted: boolean;
  onToggleHighlight: (zone: ZoneRecord) => void;
  onSwing: (item: StagedItem) => void;
}) {
  const { name, a, b, pairedBy, runA, runB, panelFullW, panelHalfW, panelH, underlay } = props;
  const comparing = runA !== null;
  const deltaSf = comparing && a && b ? Math.round(b.AcceptedSqft - a.AcceptedSqft) : null;
  const locatable = b ?? a;
  const knobs = b ? adaptedKnobs(b) : [];
  const fbKey = itemKey(name, runA, runB);

  return (
    <div
      className="flex min-w-0 flex-col gap-1.5 border bg-page p-2"
      style={{ borderColor: token("line-2"), borderRadius: "var(--radius)" }}
    >
      <div className="flex items-baseline gap-2">
        <span className="face-mono t-value font-semibold" title={name}>
          {zoneShort(name)}
        </span>
        {b ? (
          <Chip
            tone={b.triage.verdict === "solve" ? "done" : "caution"}
            title={`Triage verdict for the current run: ${b.triage.verdict} — ${b.triage.reason}`}
          >
            {b.triage.verdict}
          </Chip>
        ) : (
          <Chip
            tone="meta"
            title="This zone exists only in the baseline run — the zoning pass cut the level differently."
          >
            baseline only
          </Chip>
        )}
        {comparing && pairedBy === "name" ? (
          <Chip
            tone="meta"
            dashed
            title="One or both packages predate the stable zone key (report v4), so A/B was matched by the positional zone NAME. If zoning itself moved between the runs, this pair can compare different geography without warning."
          >
            paired by name — pre-key package
          </Chip>
        ) : null}
        {deltaSf !== null && deltaSf !== 0 ? (
          <span className="face-mono t-label">
            Δ<Delta value={deltaSf} suffix=" sf" />
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <StageButton name={name} runA={runA} runB={runB} a={a} b={b} onSwing={props.onSwing} />
          {locatable ? (
            <Press
              type="button"
              onClick={() => props.onToggleHighlight(locatable)}
              title={
                props.highlighted
                  ? "Highlighted on the plan — click to clear the highlight."
                  : "Highlight this zone on the plan (opens + centers the plan dock). Stays lit until you click again, pick another zone, or hit esc."
              }
              size="caption"
              tone="quiet"
              state={props.highlighted ? "selected" : "rest"}
              style={{
                borderColor: props.highlighted ? token("ink-2") : token("line-2"),
                borderRadius: "var(--radius)",
              }}
            >
              ⌖ highlight
            </Press>
          ) : null}
        </span>
      </div>

      <div className="flex gap-2">
        {comparing ? (
          <>
            {a && runA ? (
              <ZonePanel
                runId={runA}
                zone={a}
                maxW={panelHalfW}
                maxH={panelH}
                underlay={underlay}
              />
            ) : (
              <MissingPanel w={panelHalfW} h={panelH} label="not in baseline" />
            )}
            {b ? (
              <ZonePanel
                runId={runB}
                zone={b}
                maxW={panelHalfW}
                maxH={panelH}
                underlay={underlay}
                fbKey={fbKey}
              />
            ) : (
              <MissingPanel w={panelHalfW} h={panelH} label="not in current" />
            )}
          </>
        ) : b ? (
          <ZonePanel
            runId={runB}
            zone={b}
            maxW={panelFullW}
            maxH={panelH}
            underlay={underlay}
            fbKey={fbKey}
          />
        ) : (
          <MissingPanel w={panelFullW} h={panelH} label="not in run" />
        )}
      </div>

      <table className="face-mono w-full table-fixed t-label">
        <colgroup>
          <col className="w-[76px]" />
          {comparing ? (
            <>
              <col />
              <col />
              <col className="w-[84px]" />
            </>
          ) : (
            <col />
          )}
        </colgroup>
        {comparing ? (
          <thead>
            <tr className="t-caption text-ink-2">
              <th aria-label="stat" />
              <th className="text-left font-normal">A · baseline</th>
              <th className="text-left font-normal">B · current</th>
              <th className="text-right font-normal">Δ</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {STAT_ROWS.map((row) => (
            <tr key={row.label} className="align-top">
              <td className="pr-2 text-ink-2">{row.label}</td>
              {comparing ? (
                <>
                  <td className="truncate pr-2">{a ? row.value(a) : "—"}</td>
                  <td className="truncate pr-2">{b ? row.value(b) : "—"}</td>
                  <td className="text-right">{row.delta && a && b ? row.delta(a, b) : ""}</td>
                </>
              ) : (
                <td className="truncate">{b ? row.value(b) : "—"}</td>
              )}
            </tr>
          ))}
          {knobs.length > 0 ? (
            <tr className="align-top">
              <td className="pr-2 text-ink-2">knobs</td>
              <td colSpan={comparing ? 3 : 1}>
                <span className="flex flex-wrap gap-1">
                  {knobs.map(([k, v]) => (
                    <Chip
                      key={k}
                      tone="meta"
                      dashed
                      title={`Solver self-tuned ${k} to ${v} for this zone.`}
                    >
                      {k}={v}
                    </Chip>
                  ))}
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function RunStrip(props: {
  runs: RunIndexEntry[];
  curId: string | null;
  prevId: string | null;
  onPickCur: (id: string) => void;
  onPickBaseline: (id: string) => void;
}) {
  const { runs, curId, prevId, onPickCur, onPickBaseline } = props;
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {runs.map((entry) => {
        const isCur = entry.id === curId;
        const isPrev = entry.id === prevId;
        const meta = entry.meta;
        return (
          <div
            key={entry.id}
            className="flex shrink-0 items-stretch overflow-hidden border"
            style={{
              borderColor: isCur || isPrev ? token("ink-2") : token("line-2"),
              borderRadius: "var(--radius)",
              backgroundColor: isCur ? token("recess") : "transparent",
            }}
          >
            <Press
              type="button"
              onClick={() => onPickCur(entry.id)}
              title={`${entry.id} — click to make this the CURRENT run (B).`}
            >
              <PressContent geometry="stack">
                <span className="face-mono t-value">
                  {isCur ? <b>B · </b> : null}
                  {meta?.label ?? entry.id.slice(0, 15)}
                </span>
                <span className="face-mono t-caption text-ink-2">
                  {meta?.optionsHash.slice(0, 8) ?? "?"} · {meta ? fmtTime(meta.generatedUtc) : ""}
                  {typeof meta?.zoneFilter === "string" ? (
                    <span style={{ color: token("caution") }} title={partialTitle(meta.zoneFilter)}>
                      {" "}
                      · partial
                    </span>
                  ) : null}
                </span>
              </PressContent>
            </Press>
            <Press
              type="button"
              onClick={() => onPickBaseline(entry.id)}
              disabled={isCur}
              size="caption"
              style={{
                borderColor: token("line-2"),
                backgroundColor: isPrev ? token("recess") : "transparent",
                color: isCur ? token("line-2") : isPrev ? token("ink") : token("ink-2"),
              }}
              title={
                isPrev
                  ? "This is the baseline (A) — click to clear it."
                  : "Compare against this run as baseline (A)."
              }
            >
              {isPrev ? "A✕" : "A"}
            </Press>
          </div>
        );
      })}
    </div>
  );
}
