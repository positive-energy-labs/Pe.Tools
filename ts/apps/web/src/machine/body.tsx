/** One canonical Machine route renderer on web, PWA, and tray. */
import { useState } from "react";
import type { AppSurface, Machine, Reading } from "@pe/agent-contracts";
import { Accordion } from "#/components/lang/accordion";
import { OutcomeLine } from "#/components/lang/outcome";
import {
  attention,
  autoOpen,
  disconnected,
  hhmm,
  machineOf,
  peaState,
  revitState,
  shareState,
  updateState,
  type GroupKey,
} from "./model";
import { RevitGroup } from "./revit";
import { HostGroup } from "./host";
import { PeaGroup } from "./pea";
import { ShareGroup } from "./share";
import { UpdateGroup } from "./update";
import { SEED_REFUSAL } from "./use-machine";

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
    return reading.state === "failed" ? (
      <OutcomeLine kind="error" label={`machine reading failed: ${reading.message}`} />
    ) : (
      <OutcomeLine kind="busy" label="reading this machine" />
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
    update = updateState(machine),
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
    </div>
  );
}
