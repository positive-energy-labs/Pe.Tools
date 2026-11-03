import { Activity, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserHistory } from "@tanstack/react-router";
import type { ExecutionTarget } from "@pe/agent-contracts";
import { loadBuiltinRoute, builtinRouteStamp } from "../src/route/builtin-inventory";
import { RouteActivity, RouteVisibility } from "../src/route/activity";
import { createAdmittedPlace, type PlaceInput } from "../src/shell/admitted-place";
import { AdmittedPlacePane, admittedRouterAddress, type PanePlace } from "../src/shell/admitted-pane";
import { createRouteShell } from "../src/shell/admitted-mount";
import { sourceRouteServices } from "../src/shell/source-route-services";
import { admittedSources } from "../src/shell/admitted-sources";
import { admit } from "../src/fans/admission.fixture";

const config = (await fetch("/fixture/config").then((response) => response.json())) as {
  target: ExecutionTarget;
  system: string;
};
const [owner, presenter] = await Promise.all([
  loadBuiltinRoute("ducts", builtinRouteStamp("ducts")),
  loadBuiltinRoute("fans", builtinRouteStamp("fans")),
]);
if (!owner.ok || !presenter.ok) throw Error(JSON.stringify({ owner, presenter }));
const history = createBrowserHistory();
const address = admittedRouterAddress(history);
let current = location.pathname === "/ducts" ? "ducts" : "fans-a";
const fansRoute = new URLSearchParams(location.search).has("stale")
  ? (await admit("fans-stale-tab")).presenter
  : presenter.route;
const records = [
  { id: "ducts", route: owner.route },
  { id: "fans-a", route: fansRoute },
  { id: "fans-b", route: presenter.route },
].map((record) => {
  const initial =
    location.pathname === record.route.data.address && record.id !== "fans-b"
      ? address.read()
      : new URLSearchParams();
  const scope = {
    pathname: record.route.data.address,
    search: Object.fromEntries(initial),
    current: () => current === record.id,
    retain() {},
    retire(owner: { dispose(): void }) {
      owner.dispose();
    },
  };
  const place: PanePlace = createAdmittedPlace({ scope, address, search: initial, visible: false });
  const input: PlaceInput = {
    address: place.address,
    fixture: null,
    target: config.target,
    work: { address: null, open: config.target.kind === "document" ? config.target.ref : null },
    custody: place,
    memory: place.memory,
  };
  return {
    ...record,
    scope,
    place,
    input,
    shell: createRouteShell(sourceRouteServices(admittedSources(record.route))),
  };
});

function App() {
  const [active, setActive] = useState(current);
  const choose = (id: string) => {
    const record = records.find((record) => record.id === id)!;
    const search = record.place.address.read().toString();
    current = id;
    history.push(`${record.route.data.address}${search ? `?${search}` : ""}`);
    setActive(id);
  };
  return (
    <main className="h-screen flex flex-col bg-paper text-ink">
      <nav aria-label="Fixture Places" className="flex gap-4 p-2 border-b border-rule">
        {records.map((record) => (
          <button
            key={record.id}
            aria-pressed={record.id === active}
            onClick={() => choose(record.id)}
          >
            {record.id}
          </button>
        ))}
        <button
          onClick={() => {
            void fetch("/fixture/pea", { method: "POST" });
          }}
        >
          Pea sealed write
        </button>
      </nav>
      {records.map((record) => {
        record.place.setVisible(active === record.id);
        return (
          <Activity key={record.id} mode={active === record.id ? "visible" : "hidden"}>
            <RouteActivity value={record.scope}>
              <RouteVisibility value={active === record.id}>
                <section className="flex-1 min-h-0">
                  <AdmittedPlacePane
                    route={record.route}
                    shell={record.shell}
                    place={record.place}
                    input={record.input}
                  />
                </section>
              </RouteVisibility>
            </RouteActivity>
          </Activity>
        );
      })}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
