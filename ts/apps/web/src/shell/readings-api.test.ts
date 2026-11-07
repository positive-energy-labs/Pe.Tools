import { afterEach, expect, test, vi } from "vite-plus/test";
import { callOp, callCompose } from "../host/catalog-client";
const fetched = vi.hoisted(() => ({ host: vi.fn() }));
vi.mock("../host/runtime", () => ({ hostFetch: fetched.host }));
afterEach(() => fetched.host.mockReset());
const signal = new AbortController().signal;
const answer = (value: unknown) =>
  fetched.host.mockResolvedValue(new Response(JSON.stringify(value)));
test("native reads keep exact document scope and refuse a payload outside the catalog schema", async () => {
  answer({});
  await expect(
    callOp(
      { signal, target: { kind: "document", ref: { session: "s", openId: "d" } } },
      "revit.detail.data-tables",
      {},
    ),
  ).rejects.toThrow();
  expect(fetched.host).toHaveBeenCalledWith(
    "/call",
    expect.objectContaining({
      headers: expect.objectContaining({
        "x-pe-bridge-session-id": "s",
        "x-pe-open-document-id": "d",
      }),
      signal,
    }),
  );
});
test("TS-owned operations decode through their catalog schema too", async () => {
  answer({ content: "{}", sha256: "hash", bytesBase64: "e30=" });
  await expect(
    callOp({ signal }, "pod.member.read", { pod: "p", path: "settings/a.json" }),
  ).resolves.toMatchObject({ content: "{}", sha256: "hash", bytesBase64: "e30=" });
  answer({ content: 7 });
  await expect(
    callOp({ signal }, "pod.member.read", { pod: "p", path: "settings/a.json" }),
  ).rejects.toThrow();
});
test("compositions decode at their declared route, retaining GET and cancellation", async () => {
  answer({ captures: [] });
  await expect(callCompose({ signal }, "captures.list", {})).resolves.toEqual({ captures: [] });
  expect(fetched.host).toHaveBeenCalledWith("/captures", expect.objectContaining({ signal }));
  answer({ captures: [42] });
  await expect(callCompose({ signal }, "captures.list", {})).rejects.toThrow();
});
