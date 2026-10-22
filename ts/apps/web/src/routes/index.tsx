import { createFileRoute, stripSearchParams, type SearchSchemaInput } from "@tanstack/react-router";
import { readLink } from "@pe/agent-contracts";
import { routeSearch } from "#/route/route-owner";
import { Directory } from "#/navigation/directory";
import { Ledger } from "#/navigation/ledger";
import { LEDGER_PRESENTATIONS } from "#/navigation/ledger-model";

export const Route = createFileRoute("/")({
  validateSearch: (search: SearchSchemaInput & Record<string, unknown>) => ({
    ...routeSearch(search),
    ...readLink("home", search).page,
  }),
  search: { middlewares: [stripSearchParams(readLink("home", {}).page)] },
  component: Home,
});

/** Home: the open-work ledger beside the tool directory; under 1100 px it stacks above it. */
function Home() {
  return (
    <div className="grid min-h-full grid-cols-1 min-[1100px]:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
      <div className="min-h-0 hairline-r max-[1099px]:max-h-[24rem] max-[1099px]:overflow-auto max-[1099px]:hairline-b">
        <Ledger presentation={LEDGER_PRESENTATIONS.home} />
      </div>
      <div className="min-w-0">
        <Directory />
      </div>
    </div>
  );
}
