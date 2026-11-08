import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { address, bindWork, tools } from "@pe/agent-contracts";
import { RouteWorkspace } from "@pe/runtime";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordings } from "./native-recordings.ts";
import { captureStore, familiesReader, testDocumentMarks } from "./effect-test.ts";

export async function familiesRecorded() {
  const dir = await mkdtemp(join(tmpdir(), "pe-families-recorded-"));
  const native = await fixtureNative(join(dir, "native"), "retained-families-prepared", "driver-op.cancel");
  const socket = await native.connect();
  const captures = captureStore(join(dir, "captures"));
  const reader = await familiesReader();
  let state: unknown;
  const workspace = new RouteWorkspace({ registrations: [{ spec: tools.families.work }], store: {
    getState: async () => state, setState: async ({ value }) => { state = structuredClone(value); },
  } });
  const key = bindWork("families", address("C:/model.rvt"));
  const recorded = nativeRecordings("retained-families-prepared").responses["revit.matrix.loaded-families"] as any;
  const filter = { categoryNames: [...new Set(recorded.families.map((family: any) => family.categoryName))], familyNames: [], placementScope: "AllLoaded" };
  await workspace.publish(key, "families", [{ path: ["scope"], value: { edit: { value: filter } } }], 0);
  let wait: Promise<void> | undefined;
  let release = () => {};
  native.onRequest(async operation => {
    if (operation !== "revit.matrix.loaded-families") return;
    const input = native.calls.at(-1)!.input as { phase?: string };
    native.select(input.phase === "Prepare" ? "retained-families-prepared" : "retained-families-final");
    await wait;
  });
  const post = native.actions({ workspace, marks: testDocumentMarks(native.bridge) }, captures, { families: reader });
  const read = async (id = crypto.randomUUID()) => post({ id, key: "families.read", target: { kind: "document", ref: socket.target }, input: {
    work: { key, revision: (await workspace.read(key, "families"))!.revision }, readId: id,
  } });
  return { dir, native, socket, captures, workspace, key, post, read,
    hold() { wait = new Promise(resolve => { release = resolve; }); }, release: () => release(),
    async close() { release(); await native.close(); await rm(dir, { recursive: true, force: true }); },
  };
}
