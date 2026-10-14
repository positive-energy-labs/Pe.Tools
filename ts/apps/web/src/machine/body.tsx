/** One canonical Settings renderer on web, PWA, and tray: every machine group, then appearance. */
import { useState } from "react";
import type { AppSurface, Machine, Reading } from "@pe/agent-contracts";
import { Accordion, type AccordionGroup } from "#/components/lang/accordion";
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
import { ProviderSetup } from "./pea";
import { AccessSwitch } from "#/chat/first-open";
import { useProviders } from "#/workbench/provider/providers";
import { SettingsProjection } from "#/settings/options";
import { SettingsActions } from "#/settings/options-actions";
import { OsNoticeSettings } from "./os-notices";
import { StartupSettings } from "./startup";
import { ShareSettings } from "./share";
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

function PeaSettings({ machine, fixture }: { machine: Machine; fixture: boolean }) {
  const providers = useProviders("", !fixture, machine);
  return (
    <div className="flex flex-col gap-3">
      <ProviderSetup providers={providers} />
      <AccessSwitch providers={providers} />
    </div>
  );
}

export function SettingsBody({
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
  const gap = reading.state !== "ready";
  const waits = machine ? attention(machine) : [];
  const refusal = fixture
    ? SEED_REFUSAL
    : gap
      ? "The machine reading is not current; wait for the host."
      : null;
  const unread = (key: GroupKey, label: string): AccordionGroup => ({
    key,
    label,
    tone: "caution",
    state: reading.state === "failed" ? "read failed" : "reading",
    body:
      reading.state === "failed" ? (
        <OutcomeLine kind="error" label={`machine reading failed: ${reading.message}`} />
      ) : (
        <OutcomeLine kind="busy" label="reading this machine" />
      ),
  });
  const machineGroups: AccordionGroup[] = machine
    ? [
        {
          key: "revit",
          label: "Revit",
          state: revitState(machine).text,
          tone: revitState(machine).tone,
          body: <RevitGroup machine={machine} refusal={refusal} session={session} />,
        },
        {
          key: "update",
          label: "Update",
          state: updateSaid(machine).text,
          tone: updateSaid(machine).tone,
          body: <UpdateGroup reading={reading} fixture={fixture} />,
        },
        {
          key: "share",
          label: "Share",
          state: shareState(machine).text,
          tone: shareState(machine).tone,
          body: <ShareSettings machine={machine} fixture={fixture} stale={gap} />,
        },
        {
          key: "pea",
          label: "Pea providers",
          state: peaState(machine).text,
          tone: peaState(machine).tone,
          body: <PeaSettings machine={machine} fixture={fixture} />,
        },
        {
          key: "host",
          label: "Host",
          state: machine.host ? `${machine.host.version} · ${machine.host.payload}` : "unread",
          body: (
            <div className="flex flex-col gap-3">
              <HostGroup machine={machine} surface={shell} fixture={fixture} stale={gap} />
              <StartupSettings machine={machine} fixture={fixture} />
            </div>
          ),
        },
      ]
    : [
        unread("revit", "Revit"),
        unread("update", "Update"),
        unread("share", "Share"),
        unread("pea", "Pea providers"),
        unread("host", "Host"),
      ];
  const groups: AccordionGroup[] = [
    ...machineGroups,
    ...(shell === "tray"
      ? []
      : [
          {
            key: "notices",
            label: "Notifications",
            state: "this browser",
            body: <OsNoticeSettings />,
          },
        ]),
    {
      key: "appearance",
      label: "Appearance",
      state: "theme",
      body: <SettingsProjection />,
    },
  ];
  // An address names the group; without one, what waits opens, else the first header that disagrees.
  // Closing it is remembered here, so an address with no section does not reopen it.
  const automatic =
    autoOpen(machine) ??
    (machine
      ? (machineGroups.find((entry) => entry.tone === "caution" || entry.tone === "alarm")?.key ??
        null)
      : null);
  const open = group ?? (picked === undefined ? automatic : picked);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-shell={shell} aria-label="settings">
      <p className="m-0" data-tone={gap || waits.length ? "caution" : undefined} role="status">
        {!machine
          ? reading.state === "failed"
            ? "This machine could not be read; its groups wait for the host."
            : "Reading this machine."
          : disconnected(reading)
            ? `The host stopped answering after ${hhmm(machine.observedAtUtc)}; this is its last reading.`
            : gap
              ? "This machine reading is not current; repair actions wait for the host."
              : waits.length
                ? `${waits.join(". ")}.`
                : "Nothing waits on you."}
      </p>
      <Accordion
        label="settings groups"
        open={open}
        onOpen={(key) => {
          setPicked(key as GroupKey | null);
          onGroup?.((key ?? undefined) as GroupKey | undefined);
        }}
        groups={groups}
      />
      <Diagnostics />
      <SettingsActions />
    </div>
  );
}
