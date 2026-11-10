import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { fixtureNative } from "./fixture-native.ts";
import { nativeRecordings } from "./native-recordings.ts";
import { readTurnElementNames, type TurnElementNamesNativeRead } from "../src/turn-element-names.ts";

test("turn names use real native HTTP admission, retain their recorded names and keep cross-document ambiguity", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-element-names-recorded-"));
  const native = await fixtureNative(dir, "retained-revit.detail.elements"); const socket = await native.connect();
  const http = native.actions();
  const body = nativeRecordings("retained-revit.detail.elements").responses["revit.detail.elements"] as { entries: { elementId: number; elementUniqueId: string; name: string }[] };
  const ids = body.entries.map(entry => entry.elementId);
  const request = { kind: "turn-element-names" as const, thread: "thread", turnId: "turn", ids };
  const pinned = { thread: "thread", turnId: "turn", targets: [socket.target], complete: true };
  // HTTP envelope adaptation only. Native values and confirmed targets come from production doors.
  const read: TurnElementNamesNativeRead = async (key, request, ref) => {
    const response = await http.request(new Request("http://host/call", { method: "POST", headers: {
      "content-type": "application/json", "x-pe-bridge-session-id": ref.session, "x-pe-open-document-id": ref.openId,
    }, body: JSON.stringify({ key, request }) }));
    if (!response.ok) throw Error(await response.text());
    return { value: await response.json(), target: { documentRef: {
      session: response.headers.get("x-pe-resolved-session")!, openId: decodeURIComponent(response.headers.get("x-pe-resolved-open-id")!),
    } } };
  };
  try {
    const taken = await readTurnElementNames(pinned, request, read);
    expect(taken.entries).toEqual(body.entries.map(entry => ({ state: "resolved", elementId: entry.elementId, uniqueId: entry.elementUniqueId, name: entry.name.trim(), target: socket.target })));
    const count = native.calls.length;
    expect((await readTurnElementNames(pinned, request, read, JSON.parse(JSON.stringify(taken)))).entries).toEqual(taken.entries);
    expect(native.calls).toHaveLength(count);
    // The same saved observation at two pinned lifetimes tests identity policy, not Revit census semantics.
    const two = await readTurnElementNames({ ...pinned, targets: [socket.target, { ...socket.target, openId: "other-open" }] }, request, read);
    expect(two.entries).toEqual(ids.map(elementId => ({ state: "ambiguous", elementId })));
    const closed = await readTurnElementNames({ ...pinned, targets: [socket.target, { ...socket.target, openId: "closed-open" }] }, request, read);
    expect(closed.entries).toEqual(ids.map(elementId => ({ state: "unresolved", elementId, reason: "read-unavailable" })));
    const before = native.calls.length;
    expect((await readTurnElementNames({ ...pinned, complete: false }, request, read)).entries).toEqual(ids.map(elementId => ({ state: "unresolved", elementId, reason: "targets-unpinned" })));
    await expect(readTurnElementNames(pinned, { ...request, turnId: "other" }, read)).rejects.toThrow("pinned targets");
    expect(native.calls).toHaveLength(before);
  } finally { await native.close(); await rm(dir, { recursive: true, force: true }); }
});
// UNPROVEN[no recording]: malformed native names, unexpected ids, overlong names and false target confirmations.
