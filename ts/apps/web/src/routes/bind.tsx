import { createFileRoute } from "@tanstack/react-router";

import { routeFile, useAddressPage } from "#/route";
import { BindRoute } from "#/pages-bind/picker";

/**
 * `/bind?page=<slug>`: the human door to a Page's binding, opened by the Page's chip. No lease to
 * Pea: binding a Page is the person's press (`routeAddress("bind")`).
 */
export const Route = createFileRoute("/bind")({ ...routeFile("bind"), component: Bind });

function Bind() {
  const [{ page, view }] = useAddressPage("bind");
  return <BindRoute slug={page} view={view} />;
}
