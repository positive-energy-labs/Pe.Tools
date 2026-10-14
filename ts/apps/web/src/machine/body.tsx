/** One canonical Machine route renderer on web, PWA, and tray. */
import { useState } from "react";
import type { AppSurface, Machine, Reading } from "@pe/agent-contracts";
import { Accordion } from "#/components/lang/accordion";
import { OutcomeLine } from "#/components/lang/outcome";
import { useDiagnostics, type DiagnosticsState } from "#/host/diagnostics";
import {
  attention,
  autoOpen,
  disconnected,
  hhmm,
  machineOf,
  peaState,
  revitState,
  shareState,
  type GroupKey,
} from "./model";
import { RevitGroup } from "./revit";
import { HostGroup } from "./host";
import { PeaGroup } from "./pea";
import { ShareGroup } from "./share";
import { UpdateGroup } from "./update";
import { updateSaid } from "./update-state";
import { SEED_REFUSAL } from "./use-machine";

/**
 * This window's caught faults and whether the host heard them. It reads the diagnostic owner,
 * never `/host/status`, so a host that is down still has its silence drawn here.
 */
function DiagnosticsLine({ state }: { state: DiagnosticsState }) {
  const counts = [
    state.pending ? `${state.pending} waiting` : null,
    state.dropped ? `${state.dropped} dropped` : null,
    state.refused ? `${state.refused} refused` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const label = `diagnostics ${state.delivery}${counts ? ` · ${counts}` : ""}`;
  if (state.delivery === "idle")
    return <OutcomeLine kind="advisory" label="diagnostics · no fault caught" />;
  if (state.delivery === "delivered" && !counts)
    return (
      <OutcomeLine
        kind="receipt"
        label={label}
        says="the host took every fault this window caught"
      />
    );
  if (state.delivery === "sending") return <OutcomeLine kind="busy" label={label} />;
  return (
    <OutcomeLine
      kind={state.delivery === "refused" ? "refused" : "error"}
      label={label}
      says={state.detail ?? undefined}
    />
  );
}

function Diagnostics() {
  return <DiagnosticsLine state={useDiagnostics()} />;
}

export function MachineBody({
  reading,
  fixture,
  shell,
  group,
  session,
  onGroup,
}: {
  reading: Reading<Machine>;
  fixture: boolean;
  shell: AppSurface;
  group?: GroupKey;
  session?: string;
  onGroup?: (group: GroupKey | undefined) => void;
}) {
  const machine = machineOf(reading);
  const [picked, setPicked] = useState<GroupKey | null | undefined>(group);
  if (!machine)
    return (
      <div className="flex min-w-0 flex-col gap-1.5" data-shell={shell} aria-label="this machine">
        {reading.state === "failed" ? (
          <OutcomeLine kind="error" label={`machine reading failed: ${reading.message}`} />
        ) : (
          <OutcomeLine kind="busy" label="reading this machine" />
        )}
        <Diagnostics />
      </div>
    );
  const gap = reading.state !== "ready";
  const disconnectedHost = disconnected(reading);
  const open = onGroup ? (group ?? null) : picked === undefined ? autoOpen(machine) : picked;
  const waits = attention(machine);
  const refusal = fixture
    ? SEED_REFUSAL
    : gap
      ? "The machine reading is not current; wait for the host."
      : null;
  const revit = revitState(machine),
    update = updateSaid(machine),
    share = shareState(machine),
    pea = peaState(machine);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-shell={shell} aria-label="this machine">
      <p className="m-0" data-tone={gap || waits.length ? "caution" : undefined} role="status">
        {disconnectedHost
          ? `The host stopped answering after ${hhmm(machine.observedAtUtc)}; this is its last reading.`
          : gap
            ? "This machine reading is not current; repair actions wait for the host."
            : waits.length
              ? `${waits.join(". ")}.`
              : "Nothing waits on you."}
      </p>
      <Accordion
        label="machine groups"
        open={open}
        onOpen={(key) =>
          onGroup
            ? onGroup((key ?? undefined) as GroupKey | undefined)
            : setPicked(key as GroupKey | null)
        }
        groups={[
          {
            key: "revit",
            label: "Revit",
            state: revit.text,
            tone: revit.tone,
            body: <RevitGroup machine={machine} refusal={refusal} session={session} />,
          },
          {
            key: "update",
            label: "Update",
            state: update.text,
            tone: update.tone,
            body: <UpdateGroup reading={reading} fixture={fixture} />,
          },
          {
            key: "share",
            label: "Share",
            state: share.text,
            tone: share.tone,
            body: <ShareGroup machine={machine} />,
          },
          {
            key: "pea",
            label: "Pea",
            state: pea.text,
            tone: pea.tone,
            body: <PeaGroup fixture={fixture} machine={machine} stale={gap} />,
          },
          {
            key: "host",
            label: "Host",
            state: machine.host ? `${machine.host.version} · ${machine.host.payload}` : "unread",
            body: <HostGroup machine={machine} surface={shell} fixture={fixture} stale={gap} />,
          },
        ]}
      />
      <Diagnostics />
    </div>
  );
}
