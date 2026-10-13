/** Host identity and the existing service-token repair controls. */
import { useState } from "react";
import type { AppSurface, Machine } from "@pe/agent-contracts";
import { Button } from "#/components/lang/button";
import { OutcomeLine } from "#/components/lang/outcome";
import { PidChip } from "#/components/lang/process";
import { hostAdmin } from "#/host/machine";
import { useDestination } from "#/navigation/state";
import { useSurfaceHost } from "#/navigation/surface-host";
import { uptimeWords } from "./model";
import { SEED_REFUSAL } from "./use-machine";
import { settingsDestination } from "./navigation";

export function HostGroup({
  machine,
  surface,
  fixture,
  stale,
}: {
  machine: Machine;
  surface: AppSurface;
  fixture: boolean;
  stale: boolean;
}) {
  const go = useDestination();
  const capability = useSurfaceHost();
  const [said, setSaid] = useState<string | null>(null);
  const host = machine.host;
  if (!host)
    return (
      <p data-tone="caution">
        Host identity unread{machine.legs.host?.error ? `: ${machine.legs.host.error}` : "."}
      </p>
    );
  const refusal = fixture
    ? SEED_REFUSAL
    : stale
      ? "The host is not answering."
      : surface !== "tray" || !capability.native
        ? "Host lifecycle controls need this native tray's service token."
        : null;
  const run = (verb: "window" | "shutdown") =>
    void hostAdmin(verb).then(setSaid, (caught: unknown) => setSaid(String(caught)));
  return (
    <div className="flex flex-col gap-2" aria-label="Host runtime">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Pe.Tools</span>
        <span className="face-mono">
          {host.version} · {host.payload}
        </span>
        <PidChip pid={host.process.pid} />
        <span className="text-ink-2">up {uptimeWords(host.uptimeSeconds)}</span>
      </div>
      <p className="break-all face-mono text-ink-2">
        {host.serviceName} · {host.canonicalUrl}
      </p>
      <p className="break-all text-ink-2">
        {host.sourceRoot ?? host.installedRoot ?? "Runtime root is unverified."}
      </p>
      {host.runtimeRefusal && <p data-tone="caution">{host.runtimeRefusal}</p>}
      <div className="flex flex-wrap gap-2">
        <Button label="Startup settings" onClick={() => go(settingsDestination("startup"))}>
          Startup settings
        </Button>
        <Button label="open window" kind="framed" refusal={refusal} onClick={() => run("window")}>
          open window
        </Button>
        <Button
          label="quit host"
          kind="framed"
          reason="Stop this host; every Revit keeps running."
          refusal={refusal}
          onClick={() => run("shutdown")}
        >
          quit host
        </Button>
      </div>
      {said && <OutcomeLine kind="advisory" label={said} />}
    </div>
  );
}
