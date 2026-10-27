/**
 * /captures — every picture the host kept of a Revit view, newest first (pages ledger,
 * 2026-10-04: captures are the one picture currency). The list is host-scoped, not a Revit
 * target, so the route has no Situation: the shell head carries its name, the host lamp and the
 * one verb. `?sha=<sha>` focuses the takings of one picture, `?open=<sha,...>` unfolds receipts; the
 * `capture` inspectable opens here.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { routeAddress, type CaptureReceipt } from "@pe/agent-contracts";

import { readCaptures } from "#/captures/host";
import { CapturesList } from "#/captures/list";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { Pane } from "@pe/kit/lang/pane";
import { Surface } from "@pe/kit/lang/surface";
import { RouteShell, useRoute, useRouteLease, urlPage, type RouteManifest } from "#/route";

/**
 * The receipts are a host read, not a Reading: no Revit change mark lights them, so `refresh`
 * names `work`, which this route never has, and the verb is the only way the list re-reads.
 */
const capturePage = routeAddress("captures").schema;
const captureLocation = {
  key: "captures",
  name: "Captures",
  address: "captures" as const,
  page: capturePage,
};
const url = urlPage(captureLocation)!;

const capturesManifest = (
  reload: () => Promise<void>,
): RouteManifest<never, never, z.infer<typeof capturePage>, "refresh"> => ({
  ...captureLocation,
  docs: "Every view picture the host kept, newest first: who took it, of which view, and the receipt. Open the PNG or copy its URL into a page.",
  actions: {
    refresh: {
      label: "refresh",
      says: "re-read the kept captures from the host",
      needs: "host",
      input: z.void() as unknown as z.ZodType<never>,
      dirties: [],
      rereads: "work",
      ready: () => null,
      run: reload,
    },
  },
});

export const Route = createFileRoute("/captures")({
  validateSearch: url.read,
  search: { middlewares: [...url.middlewares] },
  component: CapturesRoute,
});

function CapturesRoute() {
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
  const [page, setPage] = handle.page;
  useRouteLease("captures", handle.page, {
    visible: captures !== null,
    facts: {
      captures: (captures ?? []).slice(0, 100).map((receipt) => ({
        sha: receipt.sha,
        view: receipt.view.name ?? null,
        at: receipt.at,
      })),
    },
  });

  return (
    <Surface head={<RouteShell manifest={manifest} handle={handle} />}>
      <Pane
        title="captures"
        meta={captures ? String(captures.length) : failure ? "unread" : "reading…"}
      >
        {failure ? <OutcomeLine kind="error" label="captures unread" says={failure} /> : null}
        {/* A re-read keeps the last list (N6); before the first one the head says "reading…". */}
        {captures ? (
          <CapturesList
            captures={captures}
            focus={page.sha}
            open={page.open}
            onPage={(next) => setPage({ sha: next.sha, open: [...(next.open ?? page.open)] })}
          />
        ) : null}
      </Pane>
    </Surface>
  );
}
