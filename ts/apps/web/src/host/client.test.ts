import type { HostOperationCatalogEntry } from "#/ops/manifest";
import { runOp } from "#/ops/run";
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

it("the catalog runner refuses unknown runtime keys before invoking the typed caller", async () => {
  const call = vi.fn().mockResolvedValue({});
  const request = {
    op: { key: "not.declared", intent: "Read" } as HostOperationCatalogEntry,
    request: {},
    target: { kind: "host" } as const,
    call,
  };
  await expect(runOp(request)).rejects.toThrow("absent from this client's contract");
  expect(call).not.toHaveBeenCalled();
  await expect(
    runOp({ ...request, op: { ...request.op, key: "logs.tail" } }),
  ).resolves.toMatchObject({ kind: "value", value: {} });
  expect(call).toHaveBeenCalledWith("logs.tail", {});
});
