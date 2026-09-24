/**
 * THE LAB — the glance layer, parked. Composed synthetic ops (many host calls, one drawing) are
 * not part of the `/ops` runner: they are experiments. Pick a document in the Situation, pick a
 * glance, watch it run. The glance switcher switches views of one target, so it stays body content.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { z } from "zod";

import { Switcher } from "#/components/lang/switcher";
import { syntheticOps } from "#/lab/glance";
import { SyntheticGlance, useSynthetic } from "#/lab/synthetic";
import { RouteShell, useRoute, type RouteManifest } from "#/route";
import { Ladder } from "#/route/ladder";
import { useChooseTarget } from "#/route/shell";
import { Situation } from "#/route/situation";
import { useDocumentLadder } from "#/route/situation-ladder";
import { SituationCell } from "#/route/situation-marks";

/**
 * The smallest manifest a Situation needs: a session target, the inventory its ladder reads, and
 * the one verb. The glance deps are host calls, not Readings, so `rereads` names the inventory:
 * no Revit change mark lights it today.
 */
const labManifest = (
  rerun: () => Promise<readonly { key: string; error?: string }[]>,
): RouteManifest<never, "inventory", Record<string, never>, "refresh"> => ({
  key: "lab",
  name: "Lab",
  docs: "Run a composed synthetic glance against one Revit session and draw it.",
  needs: "session",
  readings: { inventory: { kind: "inventory" } },
  actions: {
    refresh: {
      label: "refresh",
      says: "re-run every dep of this glance against the live host",
      needs: "session",
      actor: "any",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: [],
      rereads: "inventory",
      ready: () => null,
      run: async () => {
        const failed = await rerun();
        if (failed.length)
          throw Error(failed.map((dep) => `${dep.key} failed: ${dep.error}`).join(" · "));
      },
    },
  },
});

export const Route = createFileRoute("/lab")({ component: LabRoute });

function LabRoute() {
  const [chosen] = useChooseTarget();
  const rerun = useRef<() => Promise<readonly { key: string; error?: string }[]>>(async () => []);
  const manifest = useMemo(() => labManifest(() => rerun.current()), []);
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
  const glance = useSynthetic(op, session);
  rerun.current = glance.runAll;

  return (
    <RouteShell
      manifest={manifest}
      handle={handle}
      situation={
        <Situation
          handle={handle}
          target={{ session: ladder.sessionWord, document: ladder.docWord }}
          sentence={
            <>
              on{" "}
              <SituationCell io="r" empty={!ladder.docWord}>
                <Ladder levels={ladder.levels} />
              </SituationCell>
              .
            </>
          }
        />
      }
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
        {/* The glance is a choose-one view of the one target: the select fill, never a hue (R18). */}
        <Switcher
          ariaLabel="synthetic op"
          value={opKey ?? ""}
          onChange={setOpKey}
          options={syntheticOps.map((entry) => ({
            value: entry.key,
            label: entry.displayName,
            title: entry.blurb,
          }))}
        />
        {op ? <SyntheticGlance op={op} glance={glance} /> : null}
      </div>
    </RouteShell>
  );
}
