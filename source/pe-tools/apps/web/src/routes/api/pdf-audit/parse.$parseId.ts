import { createFileRoute } from "@tanstack/react-router";
// Side-effect type import: registers the `server` route-option augmentation.
import "@tanstack/react-start";

import { getParsedDoc } from "#/grounded-doc/parse-cache";

/** Fetch a cached parse (full grounded view: bboxes + screenshots) by jobId —
 * lets any tab ground a doc that was parsed elsewhere (another tab, pea). */
export const Route = createFileRoute("/api/pdf-audit/parse/$parseId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const view = getParsedDoc(params.parseId);
        if (!view) {
          return Response.json(
            { error: "Parse not cached (server restarted or evicted) — re-parse the document." },
            { status: 404 },
          );
        }
        return Response.json(view);
      },
    },
  },
});
