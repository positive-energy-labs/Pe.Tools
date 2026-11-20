import { expect, test } from "vite-plus/test";
import { projectRouteRead } from "../src/reads/routes.ts";
import { routeRegistry } from "../src/routes.generated.ts";
import { FINDINGS_DOORS, findingsGuide } from "@pe/agent-contracts/slots";

test("the host route read teaches every findings door alongside its catalog input and effect", () => {
  const graph = projectRouteRead(routeRegistry.rooms.host);
  expect(Object.keys(graph.findings)).toEqual(Object.values(FINDINGS_DOORS));
  for (const door of Object.values(FINDINGS_DOORS)) {
    expect(graph.findings[door]).toMatchObject({
      entry: door,
      description: findingsGuide[door],
      effect: door === FINDINGS_DOORS.list ? "Read" : "WorkWrite",
    });
    expect(graph.findings[door]?.description.length).toBeGreaterThan(0);
    expect(graph.findings[door]?.input).toHaveProperty("type", "object");
  }
  expect(JSON.stringify(graph)).not.toContain("Notes are anchored text either may write");
});
