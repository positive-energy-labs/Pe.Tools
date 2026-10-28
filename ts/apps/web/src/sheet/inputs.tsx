import type { DuctsRosterResponse, DuctsSheetInputs, DuctsSheetRequest } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { Input } from "@pe/kit/lang/input";
import { SlotPicker } from "#/ducts/proto/e/slot-picker";
import type { OpenSheet } from "./use-sheet";
import type { ElementAnchor } from "./view";

function NumberInput({
  label,
  value,
  disabled,
  commit,
}: {
  label: string;
  value: number | undefined;
  disabled: boolean;
  commit: (value: number) => void;
}) {
  return (
    <Input
      key={value ?? "unset"}
      aria-label={label}
      type="number"
      min={0}
      step="any"
      face="mono"
      defaultValue={value ?? ""}
      disabled={disabled}
      placeholder="unknown"
      onBlur={(event) => {
        const field = event.currentTarget;
        if (!field.value.trim() || !field.validity.valid || !Number.isFinite(field.valueAsNumber))
          return;
        if (field.valueAsNumber !== value) commit(field.valueAsNumber);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export function SheetInputs({
  sheet,
  slots,
  activeSlot,
  busy,
  anchor,
  change,
  rule,
}: {
  sheet: OpenSheet;
  slots: DuctsRosterResponse["slots"];
  activeSlot: string;
  busy: boolean;
  anchor: ElementAnchor;
  change: (inputs: DuctsSheetInputs) => void;
  rule: (proposal: NonNullable<DuctsSheetRequest["proposal"]>) => void;
}) {
  const edits = sheet.inputs?.edits ?? {};
  const split =
    edits.splitPolicy ??
    sheet.inputs?.inputs.find((i) => i.name === "split policy")?.value ??
    "even";
  const ends = [
    ...new Map(
      (sheet.inputs?.ends ?? [])
        .filter((e) => e.kind === "roster-fan-port" || e.kind === "joins-other-fan")
        .map((e) => [e.elementId, e]),
    ).values(),
  ];
  const blockers = [
    ...new Map(
      [...sheet.overview.blockers, ...sheet.overview.assumedBlockers].map((b) => [b.id, b]),
    ).values(),
  ];
  const drops = [
    ...new Set([
      ...blockers.filter((b) => b.kind === "unknown-drop").map((b) => b.elementId),
      ...Object.keys(edits.drops ?? {}).map(Number),
    ]),
  ];
  const proposals = [
    ...new Map(
      blockers.flatMap((b) =>
        b.proposal ? [[b.proposal.pair.join("|"), b.proposal] as const] : [],
      ),
    ).values(),
  ];
  return (
    <section aria-label="Sheet inputs" className="space-y-2 hairline-y py-2">
      <h3 className="t-head">Inputs · document Work</h3>
      <fieldset disabled={busy || !sheet.inputs} className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <span>Project airflow slot</span>
          <SlotPicker
            word="Project airflow"
            current={activeSlot}
            noun="terminals"
            where="in the document"
            options={slots.map((s) => ({
              slot: s.slot,
              have: s.covered,
              of: s.total,
              label: s.slot,
            }))}
            onPick={(slot) => change({ slot })}
          />
          <span>Split policy</span>
          {(["even", "proportional"] as const).map((policy) => (
            <Button
              key={policy}
              label={`Split ${policy}`}
              aria-pressed={split === policy}
              onClick={() => change({ splitPolicy: policy })}
            >
              {policy}
            </Button>
          ))}
        </div>
        {ends.map((end) => (
          <label key={end.elementId} className="flex items-center gap-3">
            <span>
              {end.kind} · {anchor(end.elementId)} · cfm
            </span>
            <span className="w-28">
              <NumberInput
                label={`End ${end.elementId} cfm`}
                value={edits.endCfm?.[end.elementId]}
                disabled={busy}
                commit={(value) => change({ endCfm: { [end.elementId]: value } })}
              />
            </span>
          </label>
        ))}
        {drops.map((id) => (
          <label key={id} className="flex items-center gap-3">
            <span>{anchor(id)} · drop in-wg</span>
            <span className="w-28">
              <NumberInput
                label={`Element ${id} drop in-wg`}
                value={edits.drops?.[id]}
                disabled={busy}
                commit={(value) => change({ drops: { [id]: value } })}
              />
            </span>
          </label>
        ))}
        {proposals.map((p) => (
          <div key={p.pair.join("|")} className="flex flex-wrap items-center gap-3">
            <span data-tone="caution">
              {p.kind} · {anchor(p.from.elementId)}:{p.from.connector} → {anchor(p.to.elementId)}:
              {p.to.connector ?? "body"} · {p.gapIn.toFixed(2)} in · {p.risk}
            </span>
            <Button
              label={`Accept ${p.kind} ${p.pair.join(" to ")}`}
              onClick={() => rule({ pair: p.pair, verdict: "accept" })}
            >
              accept ruling
            </Button>
            <Button
              label={`Reject ${p.kind} ${p.pair.join(" to ")}`}
              onClick={() => rule({ pair: p.pair, verdict: "reject" })}
            >
              reject
            </Button>
          </div>
        ))}
      </fieldset>
    </section>
  );
}
