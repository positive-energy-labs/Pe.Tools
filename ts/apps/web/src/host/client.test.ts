// @vitest-environment jsdom
import type { HostCaller } from "#/shell/host-call";
import { expect, expectTypeOf, it, vi } from "vite-plus/test";
import { callHostRpc } from "./client";

it("direct and target-bound calls reject undeclared keys and malformed requests", () => {
  const compileOnly = (bound: HostCaller) => {
    // @ts-expect-error Runtime-discovered strings are not an operation contract.
    void callHostRpc("not.declared");
    // @ts-expect-error Route actions use the same finite key space.
    void bound("not.declared");
    // @ts-expect-error The typed request rejects unknown fields.
    void bound("logs.tail", { notARequestField: true });
    // @ts-expect-error Required operation inputs cannot be omitted by a route.
    void bound("pod.member.read");
  };
  expectTypeOf(compileOnly).toBeFunction();
});

const io = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@pe/web-kernel/host/runtime", () => ({ hostFetch: io.fetch }));
it("retains validation issues in the host problem", async () => {
  const issues = [{ path: ["region"], message: "required" }];
  io.fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ error: { code: "invalid", message: "Invalid input", details: issues } }),
      { status: 422 },
    ),
  );
  await expect(callHostRpc("revit.detail.space-scene", { elementIds: [] })).rejects.toMatchObject({
    problem: { issues, operationKey: "revit.detail.space-scene", status: 422 },
  });
});
