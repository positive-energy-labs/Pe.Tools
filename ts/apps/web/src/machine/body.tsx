/**
 * THE MACHINE BODY — one renderer, two shells (host ledger 2026-10-09 rulings 2 and 4): the web
 * drawer behind the version chip, and the tray window (`/machine?shell=tray`). A status line says
 * what waits on the person, then four groups (Revit, Update, Share, Pea), each header carrying its
 * critical state, one open at a time, Update opening by itself while a plan waits or a receipt
 * runs. The host footer closes it. Everything drawn is the host's one `Machine` reading.
 */
import { useEffect, useState } from "react";
import type { Machine, MachineSession, Reading } from "@pe/agent-contracts";

import { Accordion } from "#/components/lang/accordion";
import { ActionButton } from "#/components/lang/action-button";
import { OutcomeLine } from "#/components/lang/outcome";
import { PidChip } from "#/components/lang/process";
import { hostAdmin } from "#/host/machine";
import { RevitControls, useInstancesBasis } from "#/open/lifecycle";

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
  uptimeWords,
  type GroupKey,
} from "./model";
import { PeaGroup } from "./pea";
import { keyOf, nameOf, phaseOf, pidOf, PHASE_TONE } from "./session";
import { ShareGroup } from "./share";
import { UpdateGroup } from "./update";
import { SEED_REFUSAL } from "./use-machine";

export type Shell = "drawer" | "tray";

type InstallPrompt = Event & { prompt: () => Promise<void> };

function RevitRow({
  session,
  basis,
  refusal,
}: {
  session: MachineSession;
  basis: ReturnType<typeof useInstancesBasis>;
  refusal: string | null;
}) {
  const row = session.row;
  const phase = phaseOf(row);
  const pid = pidOf(row);
  const documents = session.documents;
  const active = documents?.find((document) => document.isActive) ?? documents?.[0];
  const shape = [
    row.shape.payload === "checkout" ? "checkout" : null,
    row.shape.reload === "hot" ? "hot reload" : null,
    row.shape.posture === "background" ? "background" : null,
    row.shape.quarantine ? "add-ins off" : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col py-1" aria-label={`Revit ${row.year}`}>
      <span className="flex items-center gap-2">
        <span className="w-9 shrink-0 face-mono">{row.year}</span>
        <span className="min-w-0 flex-1 truncate">
          {documents === null ? (
            <span className="text-ink-2">documents unknown</span>
          ) : active ? (
            <>
              <span className={active.isModified ? "font-semibold" : undefined}>
                {active.title ?? active.path}
              </span>
              {documents.length > 1 ? (
                <span className="text-ink-2"> +{documents.length - 1}</span>
              ) : null}
            </>
          ) : (
            <span className="text-ink-2">no document open</span>
          )}
        </span>
        {pid ? <PidChip pid={pid} /> : null}
        <span data-tone={PHASE_TONE[phase]}>{phase}</span>
      </span>
      <span className="flex items-start gap-2 pl-11">
        <span className="min-w-0 flex-1 text-ink-2">
          <span className={row.case === "observed-active" ? undefined : "face-mono"}>
            {nameOf(row)}
          </span>
          {shape.length ? ` · ${shape.join(", ")}` : ""}
          {row.case === "controlled-active" && row.dialogs ? (
            <span data-tone="caution"> · dialog open</span>
          ) : null}
        </span>
        <RevitControls session={session} basis={basis} refusal={refusal} hr={false} />
      </span>
    </div>
  );
}

function HostFooter({
  machine,
  shell,
  fixture,
}: {
  machine: Machine;
  shell: Shell;
  fixture: boolean;
}) {
  const host = machine.host;
  const [said, setSaid] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    if (shell === "tray") return;
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const onInstalled = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [shell]);
  const run = (verb: "window" | "shutdown") =>
    void hostAdmin(verb).then(setSaid, (caught: unknown) => setSaid(String(caught)));
  const trayOnly =
    shell === "tray"
      ? null
      : "Only the tray holds the host's service token; use the Pe.Tools icon in the notification area.";
  const refusal = fixture ? SEED_REFUSAL : trayOnly;
  if (!host)
    return (
      <span data-tone="caution">
        Host identity unread{machine.legs.host?.error ? `: ${machine.legs.host.error}` : "."}
      </span>
    );
  return (
    <div className="hairline-t flex flex-col gap-1 pt-1.5" aria-label="host">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Pe.Tools</span>
        <span className="face-mono">{host.version}</span>
        <span className="face-mono text-ink-2">{host.payload}</span>
        <span className="text-ink-2">
          {host.startedBy ? `since ${host.startedBy} · ` : ""}up {uptimeWords(host.uptimeSeconds)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          <PidChip
            pid={host.process.pid}
            title={`host process, started ${host.process.processStartUtc}`}
          />
          <span
            className="face-mono text-ink-2"
            title="the pinned origin the window and the tailnet URL use"
          >
            :{host.port}
          </span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1">
        <span
          className="text-ink-2"
          title="the HKCU Run value; Windows Settings › Apps › Startup can also turn it off"
        >
          start at login:{" "}
          {host.autostart === "disabled-in-windows"
            ? "off in Windows"
            : (host.autostart ?? "unknown")}
        </span>
        <span className="ml-auto flex gap-1">
          <ActionButton
            label="open window"
            reason={refusal ?? "open this host in its Edge app window"}
            disabled={refusal !== null}
            onClick={() => run("window")}
          />
          <ActionButton
            label="quit host"
            reason={
              refusal ??
              "stop this host; every Revit keeps running; the next login or the Pe.Tools icon starts it again"
            }
            disabled={refusal !== null}
            onClick={() => run("shutdown")}
          />
        </span>
      </span>
      {shell === "drawer" && installPrompt && !matchMedia("(display-mode: standalone)").matches ? (
        <ActionButton
          label="Install as app"
          reason="install Pe.Tools in this Edge profile"
          onClick={() => {
            void installPrompt.prompt().catch(() => {});
            setInstallPrompt(null);
          }}
        />
      ) : null}
      {said ? <OutcomeLine kind="advisory" label={said} /> : null}
    </div>
  );
}

export function MachineBody({
  reading,
  fixture,
  shell,
  group,
}: {
  reading: Reading<Machine>;
  fixture: boolean;
  shell: Shell;
  /** A group a caller opened the body at (Pea, from a provider that needs a sign-in). */
  group?: GroupKey;
}) {
  const machine = machineOf(reading);
  const [picked, setPicked] = useState<GroupKey | null | undefined>(group);
  const basis = useInstancesBasis(!fixture);
  if (!machine)
    return reading.state === "failed" ? (
      <OutcomeLine kind="error" label={`machine reading failed: ${reading.message}`} />
    ) : (
      <OutcomeLine kind="busy" label="reading this machine" />
    );
  const gap = disconnected(reading);
  const open = picked === undefined ? autoOpen(machine) : picked;
  const waits = attention(machine);
  const refusal = fixture ? SEED_REFUSAL : gap ? "The host is not answering." : null;
  const revit = revitState(machine);
  const update = updateState(machine);
  const share = shareState(machine);
  const pea = peaState(machine);
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-shell={shell} aria-label="this machine">
      <p className="m-0" data-tone={gap || waits.length ? "caution" : undefined} role="status">
        {gap
          ? `The host stopped answering after ${hhmm(machine.observedAtUtc)}; this is its last reading.`
          : waits.length
            ? `${waits.join(". ")}.`
            : "Nothing waits on you."}
      </p>
      <Accordion
        label="machine groups"
        open={open}
        onOpen={(key) => setPicked(key as GroupKey | null)}
        groups={[
          {
            key: "revit",
            label: "Revit",
            state: revit.text,
            tone: revit.tone,
            body:
              machine.revit.sessions === null ? (
                <span data-tone="caution">The Revit census has not been read.</span>
              ) : machine.revit.sessions.length ? (
                machine.revit.sessions.map((session) => (
                  <RevitRow
                    key={keyOf(session)}
                    session={session}
                    basis={basis}
                    refusal={refusal}
                  />
                ))
              ) : (
                <span className="text-ink-2">No Revit is running. Start one from Open.</span>
              ),
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
            body: <ShareGroup machine={machine} fixture={fixture} stale={gap} />,
          },
          {
            key: "pea",
            label: "Pea",
            state: pea.text,
            tone: pea.tone,
            body: <PeaGroup fixture={fixture} />,
          },
        ]}
      />
      <HostFooter machine={machine} shell={shell} fixture={fixture} />
    </div>
  );
}
