/** Sharing observations belong to Machine; host-owned switches belong to Settings. */
import { useState } from "react";
import type { Machine } from "@pe/agent-contracts";
import { Button } from "@pe/kit/lang/button";
import { OutcomeLine } from "#/components/lang/outcome";
import { SwitchRow } from "#/components/lang/switch-row";
import { switchRemoteAdministration, switchShare } from "#/host/machine";
import { useDestination } from "#/navigation/state";
import { hhmm } from "./model";
import { SEED_REFUSAL } from "./use-machine";
import { settingsDestination } from "./navigation";
import { DeviceSettings, useLocalDevice } from "./devices";

const NEEDS_TAILSCALE =
  "Sharing needs Tailscale. Install it from tailscale.com/download, then sign in.";

export function ShareGroup({ machine }: { machine: Machine }) {
  const go = useDestination();
  return (
    <div className="flex flex-col gap-2">
      <Button label="Sharing settings" onClick={() => go(settingsDestination("sharing"))}>
        Sharing settings
      </Button>
      <ShareStatus machine={machine} />
    </div>
  );
}

function ShareStatus({ machine }: { machine: Machine }) {
  const share = machine.share;
  if (!share)
    return (
      <span data-tone="caution">
        Share state unread{machine.legs.share?.error ? `: ${machine.legs.share.error}` : "."}
      </span>
    );
  return (
    <div className="flex flex-col gap-1" aria-label="share status">
      <p>
        Sharing {share.state}
        {share.desired !== share.state ? ` · requested ${share.desired}` : ""}
      </p>
      {share.state === "needs-tailscale" && <span className="text-ink-2">{NEEDS_TAILSCALE}</span>}
      {share.refusal && share.state === "refused" && (
        <span className="face-mono text-ink-2">
          {share.refusal.code} · {share.refusal.detail}
        </span>
      )}
      {share.url && <span className="face-mono break-all">{share.url}</span>}
      {share.state === "on" &&
        (share.callers.length ? (
          <div className="flex flex-col" aria-label="callers">
            {share.callers
              .slice(-5)
              .reverse()
              .map((caller) => (
                <span key={`${caller.login}-${caller.door}`} className="flex gap-2">
                  <span className="face-mono">{caller.login}</span>
                  <span className="text-ink-2">
                    {caller.door} · last seen {hhmm(caller.lastAtUtc)}
                  </span>
                </span>
              ))}
          </div>
        ) : (
          <span className="text-ink-2">No one has called yet.</span>
        ))}
      {share.refused.length > 0 && (
        <span
          data-tone="caution"
          title={share.refused.map((row) => `${row.from} ${row.code}`).join("\n")}
        >
          {share.refused.length} request{share.refused.length === 1 ? "" : "s"} refused, latest{" "}
          {share.refused.at(-1)!.code} from {share.refused.at(-1)!.from}
        </span>
      )}
    </div>
  );
}

export function ShareSettings({
  machine,
  fixture,
  stale,
}: {
  machine: Machine;
  fixture: boolean;
  stale: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const local = useLocalDevice();
  const share = machine.share;
  if (!share) return <ShareStatus machine={machine} />;
  const unavailable = fixture
    ? SEED_REFUSAL
    : stale
      ? "The host is not answering; the switch waits for it."
      : !local
        ? "Open Sharing settings on the host to change this control."
        : null;
  const refusal =
    unavailable ??
    (share.state === "refused" && share.desired !== "on"
      ? (share.refusal?.detail ?? "The host refused to share.")
      : null);
  const change = (action: Promise<void>) => {
    setError(null);
    void action.catch((caught: unknown) => setError(String(caught)));
  };
  return (
    <div className="flex flex-col gap-2" aria-label="sharing settings">
      <SwitchRow
        label="Share over tailnet"
        checked={share.desired === "on"}
        refusal={refusal}
        disabled={share.state === "needs-tailscale" && share.desired !== "on"}
        says="serve this host over the tailnet; host control also requires device pairing"
        onCheckedChange={(on) => change(switchShare(on))}
      />
      <SwitchRow
        label="Allow remote machine administration"
        checked={share.allowRemoteAdministration}
        refusal={unavailable}
        says="local switch; paired remote browsers may administer this host and grant document rw when on"
        onCheckedChange={(allowed) => change(switchRemoteAdministration(allowed))}
      />
      <span className="text-ink-2">
        Remote rw consent requires remote administration. It starts off. Shared Pages and captures
        do not grant host control. MCP pairing starts read-only and can use a thread grant only
        after a human binds it here.
      </span>
      <ShareStatus machine={machine} />
      <DeviceSettings refusal={unavailable} />
      {error && <OutcomeLine kind="refused" label={error} />}
    </div>
  );
}
