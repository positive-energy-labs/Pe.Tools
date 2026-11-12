import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { bindWork, workKey, ductsRouteState, fansRouteState } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { readStoredNotices } from "@pe/host-contracts/store";
import { storedNoticesPath } from "../src/notice-feed.ts";
import { fileRouteDocumentStore } from "../src/route-document-store.ts";

for (const [spec, previous, removed, staged, dropped] of [
  [ductsRouteState, 2, "designFriction", { labelParameter: { edit: { value: "Mark" } } }, { edit: { value: 0.12 } }],
  [fansRouteState, 1, "parameters", { writeIntent: { edit: { value: { walk: { unitId: 42, portIndex: 0 } } } } }, { fanFlow: { edit: { value: "Design Flow" } } }],
] as const) {
  test.each([false, true])(`${spec.route} upgrades pre-h2 Work and notices non-empty settings: %s`, async (nonempty) => {
    const dir = await mkdtemp(join(tmpdir(), "pe-work-upgrade-"));
    const store = fileRouteDocumentStore(dir);
    const key = bindWork(spec.route, null), targetKey = workKey(key);
    const read = () => new RouteWorkspace({ store, registrations: [{ spec }] }).readUncaptured(key, spec.route);
    const before = readStoredNotices(storedNoticesPath());
    try {
      await store.setState({ targetKey, route: spec.route, value: {
        version: 1, schemaVersion: previous, revision: 7,
        doc: { ...spec.schema.parse({}), ...staged, [removed]: nonempty ? dropped : {} }, history: [],
      } });
      expect(await read()).toMatchObject({ revision: 7, schemaVersion: previous + 1, doc: staged });
      const saved = await store.getState({ targetKey, route: spec.route });
      expect(saved).toMatchObject({ schemaVersion: previous + 1, revision: 7, doc: staged });
      expect((saved as { doc: unknown }).doc).not.toHaveProperty(removed);
      await read();
      const notices = readStoredNotices(storedNoticesPath()).slice(before.length);
      expect(notices).toHaveLength(nonempty ? 1 : 0);
      if (nonempty) {
        expect(notices[0]!.reason).toContain(removed);
        expect(notices[0]!.reason).toContain(JSON.stringify(dropped));
        expect(notices[0]!.reason).toContain("settings at the project or firm tier");
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
}
