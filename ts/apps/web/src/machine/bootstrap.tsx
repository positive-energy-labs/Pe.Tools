import { useState } from "react";
import type { ActionReceipt, Machine } from "@pe/agent-contracts";
import { GENERATED_FROM } from "@pe/host-contracts/pe-revit-contract";
import { bootstrapBlockers } from "@pe/host-contracts/pe-api";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { alignRevitBootstrap } from "#/host/machine";
import { useAction } from "#/readings";

export function BootstrapAlignment({
  machine,
  refusal,
}: {
  machine: Machine;
  refusal: string | null;
}) {
  const [year, setYear] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ActionReceipt | null>(null);
  const install = useAction(
    (year: string) => alignRevitBootstrap(year, GENERATED_FROM),
    (result) => {
      setReceipt(result);
      setYear(null);
    },
  );
  const open = machine.revit.sessions
    ? bootstrapBlockers(machine.revit.sessions.map((session) => session.row))
    : undefined;
  const blocked =
    refusal ??
    (machine.legs.sessions?.error || open === undefined
      ? "The complete Revit census is unavailable. Wait for a fresh reading."
      : open.length
        ? `Close every Revit first: ${open.join("; ")}.`
        : null);
  return (
    <section
      id="align-addins"
      aria-label="Align Revit add-ins with this build"
      className="flex flex-col gap-1 hairline-b py-2"
    >
      <span className="font-semibold">Align Revit add-ins with this build</span>
      <p className="text-ink-2">
        Installs this host's pinned SDK <span className="face-mono">{GENERATED_FROM}</span> for the
        selected Revit year. All Revit sessions must be closed.
      </p>
      <div className="flex flex-wrap gap-2">
        {machine.revit.years?.map((value) => (
          <Button
            key={value}
            label={`Align Revit ${value} add-ins with this build`}
            refusal={blocked}
            busy={install.isPending}
            onClick={() => setYear(String(value))}
          >
            Revit {value}
          </Button>
        ))}
      </div>
      {!machine.revit.years?.length && (
        <p className="text-ink-2">No installed Revit year is known.</p>
      )}
      {blocked && <p data-tone="caution">{blocked}</p>}
      {year && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Confirm bootstrap installation"
        >
          <Button
            label={`Install Revit ${year} add-ins for SDK ${GENERATED_FROM}`}
            refusal={blocked}
            busy={install.isPending}
            onClick={() => install.mutate(year)}
          >
            Install Revit {year} add-ins for SDK {GENERATED_FROM}
          </Button>
          <Button label="Cancel alignment" busy={install.isPending} onClick={() => setYear(null)}>
            Cancel
          </Button>
        </div>
      )}
      {install.isPending && <OutcomeLine kind="busy" label="Aligning Revit add-ins" />}
      {install.error && <OutcomeLine kind="error" label={install.error.message} />}
      {receipt && (
        <OutcomeLine
          kind={receipt.state === "succeeded" ? "receipt" : "refused"}
          label={`receipt ${receipt.id} · ${receipt.state}`}
          says={"error" in receipt ? receipt.error : undefined}
        />
      )}
    </section>
  );
}
