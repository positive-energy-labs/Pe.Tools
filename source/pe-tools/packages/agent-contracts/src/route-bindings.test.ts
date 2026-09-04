import { describe, expect, it } from "vite-plus/test";

import {
  familiesRouteState,
  familyRouteState,
  opsRouteState,
  settingsRouteState,
  takeoffsRouteState,
} from "./index.ts";

describe("route bindings", () => {
  it("accepts named bindings on every routed document and never a world", () => {
    const bind = { id: "profile-a", label: "Profile A" } as const;
    for (const spec of [
      takeoffsRouteState,
      familyRouteState,
      familiesRouteState,
      settingsRouteState,
      opsRouteState,
    ]) {
      const doc = spec.schema.parse({ bindings: { profile: bind } });
      expect(doc.bindings.profile).toEqual(bind);
      expect(spec.schema.parse({}).bindings).toEqual({});
    }
  });
});
