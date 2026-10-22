import { createFileRoute, Link } from "@tanstack/react-router";

import { PRODUCT_MAP } from "@pe/agent-contracts/product-map";
import { RouteShell, defineRoute } from "#/route";
import { Legend, Mermaid, PartsTable, chainChart, pathChart } from "#/product-map/diagram";

/** The whole product chain from rooms to basis of design, drawn from `@pe/agent-contracts/product-map`. */
export const manifest = defineRoute({
  key: "map",
  name: "Product map",
  views: [{ key: "map", label: "Product map", draws: () => <MapRoute /> }],
  docs: "Every link from rooms to basis of design: what each needs, where its data is stored, and how ready it is. Edit `ts/packages/agent-contracts/src/product-map.ts` to change it.",
});

export const Route = createFileRoute("/map")({
  component: () => manifest.views![0]!.draws({ readings: {} }),
});

function MapRoute() {
  return (
    <RouteShell manifest={manifest}>
      <div className="flex flex-col gap-4 overflow-y-auto p-6">
        <Legend />
        <Mermaid chart={chainChart()} />
        {PRODUCT_MAP.map((link) => (
          <section key={link.id} className="flex flex-col gap-1">
            <h3>
              {link.label}
              {link.route ? (
                <>
                  {" "}
                  <Link to={link.route} className="t-small">
                    {link.route}
                  </Link>
                </>
              ) : null}
            </h3>
            <p className="max-w-[80ch]">{link.note}</p>
            {link.parts.length ? (
              <>
                <Mermaid chart={pathChart(link)} />
                <PartsTable parts={link.parts} />
              </>
            ) : null}
          </section>
        ))}
      </div>
    </RouteShell>
  );
}
