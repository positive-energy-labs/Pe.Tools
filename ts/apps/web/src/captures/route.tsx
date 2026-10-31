import type { CaptureReceipt } from "@pe/agent-contracts";
import { OutcomeLine } from "@pe/kit/lang/outcome";
import { routeFromGraph, type RouteAdapters } from "#/shell/mount";
import { capturesGraph, type CapturesPage } from "./graph";
import { capturesSources } from "./sources";
import { CapturesList } from "./list";
export const capturesAdapters: RouteAdapters<CapturesPage, never> = {
  sources: capturesSources(),
  subjects: {},
  verbReadings: { refresh: ["captures"] },
  bodies: {
    captures: ({ owner, page }) => {
      const reading = owner.readings.get("captures");
      const captures = (reading.value ?? reading.previous) as CaptureReceipt[] | undefined;
      return (
        <>
          {reading.error ? (
            <OutcomeLine kind="error" label="captures unread" says={reading.error} />
          ) : null}
          {captures ? (
            <CapturesList
              captures={captures}
              focus={page.sha}
              open={page.open}
              onPage={(next) =>
                owner.view.setPage({ sha: next.sha, open: [...(next.open ?? page.open)] })
              }
            />
          ) : null}
        </>
      );
    },
  },
};
export const capturesRoute = routeFromGraph(capturesGraph, capturesAdapters, "/captures");
