import { describe, expect, it } from "vite-plus/test";

import {
  address,
  current,
  familiesRouteState,
  familyRouteState,
  opsRouteState,
  settingsRouteState,
  takeoffsRouteState,
} from "./index.ts";

describe("document-scoped route bindings", () => {
  it("projects a matching binding from every routed document", () => {
    const at = address("C:\\Models\\projectA.rvt");
    const bind = { id: "controlled", label: "pe.app-25", at };
    for (const spec of [
      takeoffsRouteState,
      familyRouteState,
      familiesRouteState,
      settingsRouteState,
      opsRouteState,
    ]) {
      const doc = spec.schema.parse({ bindings: { world: bind } });
      expect(current(doc.bindings.world, at)).toEqual(bind);
    }
  });

  it("does not project a binding minted for another document", () => {
    const bind = {
      id: "controlled",
      label: "pe.app-25",
      at: address("C:\\Models\\Other.rvt"),
    };
    expect(current(bind, address("C:\\Models\\projectA.rvt"))).toBeNull();
  });
});
