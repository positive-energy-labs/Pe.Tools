import { createRoot } from "react-dom/client";
import { createMemoryHistory, createRouter, RouterContextProvider } from "@tanstack/react-router";
import { Route as root } from "../src/routes/__root";
import { ductsRoute } from "../src/ducts/route";
import { DuctsHostFixture } from "../src/ducts/host.fixture";
import { twoHealNetworksSnapshot } from "../src/ducts/heal.fixture";

const host = new DuctsHostFixture();
host.snapshot = twoHealNetworksSnapshot();
for (let index = 1; index <= 80; index++) {
  const name = `FA ${index}`;
  host.snapshot.systems.push({ ...host.snapshot.systems[0]!, id: 1000 + index, name });
  host.snapshot.groups.push({
    ...host.snapshot.groups[0]!,
    id: `g${index}`,
    systemNames: [name],
    rootIds: [],
    terminalCount: 0,
    issueIds: [],
  });
}
Object.assign(globalThis, { fetch: host.fetch, EventSource: host.source(), Worker: host.worker });
const router = createRouter({
  routeTree: root.addChildren([ductsRoute]),
  history: createMemoryHistory({
    initialEntries: ["/ducts?target=s&system=RA%2023&picture=schematic&layers="],
  }),
});
router.history.subscribe(router.load);
await router.load();
const Component = ductsRoute.options.component!;
createRoot(document.getElementById("root")!).render(
  <RouterContextProvider router={router}>
    <Component />
  </RouterContextProvider>,
);
Object.assign(globalThis, { healProof: { actions: host.actions } });
