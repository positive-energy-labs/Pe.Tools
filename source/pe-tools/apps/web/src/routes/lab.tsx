/**
 * THE LAB — the glance layer, parked. Composed synthetic ops (many host calls, one drawing) are
 * not part of the `/ops` runner: they are experiments. Pick one, pick a session, watch it run.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { Press } from "#/components/lang/press";
import { syntheticOps } from "#/lab/glance";
import { SyntheticRunner } from "#/lab/synthetic";
import { RouteShell, emptyManifest, useRoute, type RouteManifest } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { useDocumentLadder } from "#/route/situation";

/** Not cut over yet: the lab needs a session to call the host, and nothing else. */
export const manifest: RouteManifest<never, "inventory", Record<string, never>, never> = {
  ...emptyManifest("lab", "Lab"),
  needs: "session",
  readings: { inventory: { kind: "inventory" } },
};

export const Route = createFileRoute("/lab")({ component: LabRoute });

function LabRoute() {
  const [chosen] = useChooseTarget();
  const handle = useRoute(manifest, { target: chosen });
  const ladder = useDocumentLadder(handle);
  const [opKey, setOpKey] = useState(syntheticOps[0]?.key);
  const op = syntheticOps.find((entry) => entry.key === opKey);
  const resolved = handle.resolution.kind === "resolved" ? handle.resolution.target : null;
  const session =
    resolved?.kind === "session"
      ? resolved.session
      : resolved?.kind === "document"
        ? resolved.ref.session
        : undefined;

  return (
    <RouteShell manifest={manifest} handle={handle}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {syntheticOps.map((entry) => (
            <Press
              key={entry.key}
              size="caption"
              tone={entry.key === opKey ? "agent" : "neutral"}
              title={entry.blurb}
              onClick={() => setOpKey(entry.key)}
            >
              {entry.displayName}
            </Press>
          ))}
          <Ladder levels={ladder.levels} />
        </div>
        {op ? <SyntheticRunner op={op} {...(session ? { bridgeSessionId: session } : {})} /> : null}
      </div>
    </RouteShell>
  );
}
