/** Host identity, the existing service-token repair controls, and this machine's content homes. */
import { useEffect, useState, useTransition } from "react";
import type { z } from "zod";
import type { AppSurface, Machine } from "@pe/agent-contracts";
import type { httpRoutes } from "@pe/agent-contracts/pe-api";
import { Button } from "@pe/kit/lang/button";
import { Input, Label } from "@pe/kit/lang/input";
import { peClient } from "#/host/pe-client";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { PidChip } from "#/components/lang/process";
import { hostAdmin } from "#/host/machine";
import { useSurfaceHost } from "#/navigation/surface-host";
import { uptimeWords } from "./model";
import { SEED_REFUSAL } from "./use-machine";

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
      {host.redirectionTrust === "enforced" && (
        <p data-tone="caution">
          Windows RedirectionGuard is enforced on this host (inherited from its launcher): harness
          CLIs it starts cannot traverse user junctions.
        </p>
      )}
      {host.runtimeRefusal && <p data-tone="caution">{host.runtimeRefusal}</p>}
      <div className="flex flex-wrap gap-2">
        <Button label="open window" refusal={refusal} onClick={() => run("window")}>
          open window
        </Button>
        <Button
          label="quit host"
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

type HomesStatus = z.output<(typeof httpRoutes)["homes.get"]["output"]>;
const foundWords: Record<HomesStatus["homes"][number]["found"], string> = {
  documents: "Documents folder",
  override: "environment override",
  config: "chosen here",
  pointer: "model pointer",
  default: "default folder",
};
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The firm and user homes (ADR 0037), chosen here and kept in this machine's `state\homes.json`.
 * A blank field returns that home to its default: the default folder for firm, Documents for user.
 */
export function HomesSettings({ refusal }: { refusal: string | null }) {
  const [status, setStatus] = useState<HomesStatus | null>(null);
  const [firm, setFirm] = useState("");
  const [user, setUser] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const show = (next: HomesStatus) => {
    setStatus(next);
    setFirm(next.config.firm ?? "");
    setUser(next.config.user ?? "");
  };
  useEffect(() => {
    if (refusal) return;
    void peClient.call("homes.get", {}).then(show, (error: unknown) => setSaid(message(error)));
  }, [refusal]);
  const save = () =>
    startTransition(async () => {
      setSaid(null);
      try {
        const body = {
          ...(firm.trim() ? { firm: firm.trim() } : {}),
          ...(user.trim() ? { user: user.trim() } : {}),
        };
        show(await peClient.call("homes.put", { body }));
        setSaid("Homes saved.");
      } catch (error) {
        setSaid(message(error));
      }
    });
  return (
    <div className="flex flex-col gap-2" aria-label="Content homes">
      <span className="font-semibold">Content homes</span>
      {status?.homes.map((home) => (
        <p key={home.tier} className="break-all">
          <span className="font-semibold">{home.tier}</span>{" "}
          <span className="face-mono">{home.path}</span>{" "}
          <span className="text-ink-2">({foundWords[home.found]})</span>
        </p>
      ))}
      {status?.firmNotice && <p data-tone="caution">{status.firmNotice}</p>}
      {status?.configError && <p data-tone="caution">{status.configError}</p>}
      <Label>
        Firm home
        <Input
          face="mono"
          value={firm}
          placeholder="The firm default on G:"
          onChange={(event) => setFirm(event.target.value)}
        />
      </Label>
      <Label>
        User home
        <Input
          face="mono"
          value={user}
          placeholder="Documents\Pe.Tools"
          onChange={(event) => setUser(event.target.value)}
        />
      </Label>
      <p className="text-ink-2">Absolute folders that exist. Blank uses the default.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          label="save homes"
          refusal={refusal ?? (pending ? "Waiting for the host." : null)}
          onClick={save}
        >
          save homes
        </Button>
      </div>
      {said && <OutcomeLine kind="advisory" label={said} />}
    </div>
  );
}
