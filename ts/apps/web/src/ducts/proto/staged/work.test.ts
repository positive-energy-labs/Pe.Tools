import { existsSync, readFileSync } from "node:fs";

import { ductClaimSchema, ductsDocumentSchema } from "@pe/agent-contracts";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import { expect, it } from "vite-plus/test";

import { STAGED_WORK } from "./work";

/** TEST-ONLY IMITATION: holds the hand-authored staged work to the real Chadds snapshot. */
const SNAPSHOT =
  "C:/Users/kaitp/source/repos/Pe.Tools/.artifacts/proto/ducts-r1/real/snapshot.json";

it.skipIf(!existsSync(SNAPSHOT))("imitation work pins every id to the real Chadds snapshot", () => {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as DuctSnapshot;
  const known = new Set([...snapshot.nodes, ...snapshot.segments].map((e) => e.id));
  const groups = new Set(snapshot.groups.map((g) => g.id));
  for (const [groupId, doc] of Object.entries(STAGED_WORK)) {
    expect(groups.has(groupId), groupId).toBe(true);
    ductsDocumentSchema.parse(doc);
    const subject = doc.subject[groupId]?.proposal?.value ?? [];
    expect(subject.length).toBeGreaterThan(0);
    expect(
      subject.filter((id) => !known.has(id)),
      `${groupId} subject`,
    ).toEqual([]);
    const claims = Object.entries(doc.claims);
    expect(claims.length).toBeGreaterThanOrEqual(4);
    for (const [key, cell] of claims) {
      expect(cell.proposal?.note).toMatch(/TEST-ONLY IMITATION/);
      const claim = ductClaimSchema.parse(cell.proposal?.value);
      expect(claim.verdict).toBeUndefined();
      expect(
        claim.ids.filter((id) => !known.has(id)),
        `${groupId}/${key}`,
      ).toEqual([]);
    }
  }
});
