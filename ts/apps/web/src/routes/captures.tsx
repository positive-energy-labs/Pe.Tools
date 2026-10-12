/**
 * /captures — every picture the host kept of a Revit view, newest first (pages ledger,
 * 2026-10-04: captures are the one picture currency). The list is host-scoped, not a Revit
 * target, so the route has no Situation: the shell head carries its name, the host lamp and the
 * one verb. `?sha=<sha>` focuses the takings of one picture; the `capture` inspectable opens here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import type { CaptureReceipt } from "@pe/agent-contracts";

import { readCaptures } from "#/captures/host";
import { CapturesList } from "#/captures/list";
import { OutcomeLine } from "#/components/lang/outcome";
import { Pane } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { RouteShell, useRoute, type RouteManifest } from "#/route";

/**
 * The receipts are a host read, not a Reading: no Revit change mark lights them, so `refresh`
 * names `work`, which this route never has, and the verb is the only way the list re-reads.
 */
const capturesManifest = (
  reload: () => Promise<void>,
): RouteManifest<never, never, Record<string, never>, "refresh"> => ({
  key: "captures",
  name: "Captures",
  docs: "Every view picture the host kept, newest first: who took it, of which view, and the receipt. Open the PNG or copy its URL into a page.",
  actions: {
    refresh: {
      label: "refresh",
      says: "re-read the kept captures from the host",
      needs: "host",
      actor: "any",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: [],
      rereads: "work",
      ready: () => null,
      run: reload,
    },
  },
});

export const Route = createFileRoute("/captures")({
  validateSearch: (search: Record<string, unknown>): { sha?: string } =>
    typeof search.sha === "string" && search.sha ? { sha: search.sha } : {},
  component: CapturesRoute,
});

function CapturesRoute() {
  const { sha } = Route.useSearch();
  const [captures, setCaptures] = useState<CaptureReceipt[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      readCaptures().then(
        (list) => {
          setCaptures(list);
          setFailure(null);
        },
        (error: unknown) => {
          setFailure(error instanceof Error ? error.message : String(error));
          throw error;
        },
      ),
    [],
  );
  useEffect(() => {
    void reload().catch(() => undefined);
  }, [reload]);
  const manifest = useMemo(() => capturesManifest(reload), [reload]);
  const handle = useRoute(manifest, { target: null });

  return (
    <Surface head={<RouteShell manifest={manifest} handle={handle} />}>
      <Pane kind="content" title="captures" meta={captures ? String(captures.length) : undefined}>
        {failure ? <OutcomeLine kind="error" label="captures unread" says={failure} /> : null}
        {captures ? <CapturesList captures={captures} focus={sha} /> : null}
      </Pane>
    </Surface>
  );
}
