import { createFileRoute } from "@tanstack/react-router";
import { SpaceRoute } from "#/space/route";

export const Route = createFileRoute("/space")({
  validateSearch: (s: Record<string, unknown>) => ({
    scene: typeof s.scene === "string" ? s.scene : undefined,
    session: typeof s.session === "string" ? s.session : undefined,
    doc: typeof s.doc === "string" ? s.doc : undefined,
    ids: typeof s.ids === "string" ? s.ids : undefined,
  }),
  component: () => <SpaceRoute {...Route.useSearch()} />,
});
