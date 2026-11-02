import { readFileSync } from "node:fs";
import { expect, test, vi } from "vite-plus/test";
import { lossSnapshot } from "../src/ducts-actions.ts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsRouteState } from "@pe/agent-contracts";
import { price, applyRequest } from "@pe/ducts-domain/pricing";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";

test("fan loss preparation reads the selected connector walk and carries authored drops into preview", async () => {
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(JSON.parse(readFileSync(
    new URL("../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json", import.meta.url), "utf8")));
  const read = vi.fn(async () => snapshot);
  expect(await lossSnapshot({ walk: { unitId: 14577391, portIndex: 2 } }, read)).toBe(snapshot);
  expect(read).toHaveBeenCalledExactlyOnceWith({ kind: "from", unitId: 14577391, portIndex: 2 });
  const node = snapshot.nodes.find((n) => n.id === 14088043)!;
  expect(node).toBeTruthy();
  const work = ductsRouteState.schema.parse({ componentDrops: { [node.id]: { edit: { value: { inWg: 0.026 } } } } });
  const request = applyRequest(snapshot, price(snapshot, {}, work, EMPTY_CATALOGS), "2026-11-02T10:00:00Z", []);
  expect(request.components).toContainEqual(expect.objectContaining({ id: node.id, inWg: 0.026 }));
});

