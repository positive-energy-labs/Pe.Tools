/**
 * The Share group: one switch over the installed host's Tailscale Serve mapping, the URL it
 * serves, the callers it has seen (observations with their last time, never a presence claim),
 * and the requests it refused. The switch is local-only on the host; a remote caller is refused
 * there and the refusal is drawn here.
 */
import { useState } from "react";
import type { Machine } from "@pe/agent-contracts";

import { OutcomeLine } from "#/components/lang/outcome";
import { SwitchRow } from "#/components/lang/switch-row";
import { switchShare } from "#/host/machine";

import { hhmm } from "./model";
import { SEED_REFUSAL } from "./use-machine";

export function ShareGroup({
  machine,
  fixture,
  stale,
}: {
  machine: Machine;
  fixture: boolean;
  stale: boolean;
}) {
  const share = machine.share;
  const [error, setError] = useState<string | null>(null);
  if (!share)
    return (
      <span data-tone="caution">
        Share state unread{machine.legs.share?.error ? `: ${machine.legs.share.error}` : "."}
      </span>
    );
  const refusal = fixture
    ? SEED_REFUSAL
    : stale
      ? "The host is not answering; the switch waits for it."
      : share.state === "refused"
        ? (share.refusal?.detail ?? "The host refused to share.")
        : null;
  const url = share.url?.replace(/^https?:\/\//, "");
  return (
    <div className="flex flex-col gap-1" aria-label="share">
      <SwitchRow
        label="Share over tailnet"
        checked={share.state === "on"}
        refusal={refusal}
        says="serve this host to people on your tailnet; their tailnet identity is the credential"
        onCheckedChange={(on) => {
          setError(null);
          switchShare(on).catch((caught: unknown) => setError(String(caught)));
        }}
      />
      {share.refusal && share.state === "refused" ? (
        <span className="face-mono text-ink-2">{share.refusal.code}</span>
      ) : null}
      {url ? (
        <span className="flex items-center gap-2">
          <span className="face-mono">{url}</span>
          <span className="text-ink-2">
            {share.state === "on"
              ? "serves this window, /pe and /mcp"
              : share.desired !== share.state
                ? `turning ${share.desired}`
                : "not served"}
          </span>
        </span>
      ) : null}
      {share.state === "on" ? (
        share.callers.length ? (
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
        )
      ) : null}
      {share.refused.length ? (
        <span
          data-tone="caution"
          title={share.refused.map((row) => `${row.from} ${row.code}`).join("\n")}
        >
          {share.refused.length} request{share.refused.length === 1 ? "" : "s"} refused, latest{" "}
          {share.refused.at(-1)!.code} from {share.refused.at(-1)!.from}
        </span>
      ) : null}
      {error ? <OutcomeLine kind="refused" label={error} /> : null}
    </div>
  );
}
