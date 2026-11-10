import { createFileRoute, notFound, type SearchSchemaInput } from "@tanstack/react-router";
import { workFingerprintSchema } from "@pe/agent-contracts";
import { routeAt } from "../route/registry";
import type { routeSearch } from "../shell/owner";
import { TypedShell } from "../shell/typed-shell";

/**
 * Every one-segment builtin address (ADR 0035 rule 4): the web registry resolves `/<route>` to its
 * declaration. A dock route (Pea at `/pea`) renders nothing here; the dock draws it. Static files
 * (`design-system_.swatch`) outrank this segment, so satellites keep their own files.
 */
export const Route = createFileRoute("/$route")({
  // Exception to no casts: as routeFile, router search is projected; the typed mount decodes the Page.
  validateSearch: (search: SearchSchemaInput & Record<string, unknown>) =>
    search as unknown as ReturnType<typeof routeSearch> & Record<string, unknown>,
  beforeLoad: ({ params }) => {
    if (!routeAt(`/${params.route}`)) throw notFound();
  },
  component: Builtin,
});

function Builtin() {
  const { route } = Route.useParams();
  const row = routeAt(`/${route}`)!;
  if (row.dock) return null;
  const fingerprint = workFingerprintSchema.parse(`builtin-closure:${row.closure.fingerprint}`);
  // One component serves every address: the key remounts the shell when the route changes.
  return <TypedShell key={row.key} module={row.module} fingerprint={fingerprint} />;
}
