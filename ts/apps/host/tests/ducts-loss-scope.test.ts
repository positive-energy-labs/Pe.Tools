import { readFileSync } from "node:fs";
import { expect, test, vi } from "vite-plus/test";
import { ductWriteEvidence, lossSnapshot } from "../src/ducts-actions.ts";
import { writeSeal } from "../src/work-write-boundary.ts";
import { nativeResponseSchema } from "@pe/host-contracts/decoders";
import { ductsRouteState } from "@pe/agent-contracts";
import { price, applyRequest } from "@pe/ducts-domain/pricing";
import { EMPTY_CATALOGS } from "@pe/ducts-domain/catalog";

test("fan preview survives identical re-pricing but rejects changed model inputs", () => {
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const work = ductsRouteState.schema.parse({
    componentDrops: { "14088043": { edit: { value: { inWg: 0.026 } } } },
  });
  const handle = {
    key: {
      binding: "open" as const,
      route: "ducts",
      target: null,
      open: { session: "A", openId: "doc" },
    },
    revision: 1,
  };
  const seal = (s: typeof snapshot) =>
    writeSeal(
      applyRequest(s, price(s, {}, work, EMPTY_CATALOGS), "", []),
      work,
      handle,
      { openId: "doc" },
      [],
      ductWriteEvidence(s),
    );
  snapshot.walk = {
    startId: 14577391,
    hops: 1,
    elementsReached: snapshot.nodes.length,
    openEnds: 0,
    candidates: [],
    truncated: false,
    elapsedMs: 12,
  };
  const preview = seal(snapshot);
  const reread = structuredClone(snapshot);
  reread.document.readAt = "2026-11-02T12:00:00Z";
  reread.document.elapsedMs += 100;
  reread.walk!.elapsedMs += 100;
  reread.nodes.reverse();
  for (const node of reread.nodes) node.connectors.reverse();
  for (const segment of reread.segments) segment.connectors.reverse();
  for (const issue of reread.issues) issue.near?.ports.reverse();
  expect(seal(reread)).toEqual(preview);
  reread.slots.fanFlow = "another parameter";
  expect(seal(reread)).not.toEqual(preview);
});

test("fan loss preparation reads the selected connector walk and carries authored drops into preview", async () => {
  const snapshot = nativeResponseSchema("ducts.snapshot.walk").parse(
    JSON.parse(
      readFileSync(
        new URL(
          "../../../packages/host-contracts/src/fixtures/k2-four-fan-walk.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const read = vi.fn(async () => snapshot);
  expect(await lossSnapshot({ walk: { unitId: 14577391, portIndex: 2 } }, read)).toBe(snapshot);
  expect(read).toHaveBeenCalledExactlyOnceWith({ kind: "from", unitId: 14577391, portIndex: 2 });
  const node = snapshot.nodes.find((n) => n.id === 14088043)!;
  expect(node).toBeTruthy();
  const work = ductsRouteState.schema.parse({
    componentDrops: { [node.id]: { edit: { value: { inWg: 0.026 } } } },
  });
  const request = applyRequest(
    snapshot,
    price(snapshot, {}, work, EMPTY_CATALOGS),
    "2026-11-02T10:00:00Z",
    [],
  );
  expect(request.components).toContainEqual(expect.objectContaining({ id: node.id, inWg: 0.026 }));
});
