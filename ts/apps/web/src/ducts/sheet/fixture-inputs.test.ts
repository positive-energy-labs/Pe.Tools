import { designOf } from "@pe/ducts-domain/test-design";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { stagedDucts } from "@pe/agent-contracts";
import { resolveCriteria } from "@pe/ducts-domain/sheet/index";
import { createWitness } from "../../fans/cutover.test-support";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../../packages/agent-contracts/src/work-journal-door";
const closes: (() => void)[] = [];
afterEach(() =>
  closes
    .splice(0)
    .reverse()
    .forEach((close) => close()),
);
const settle = (value: Observation<WorkWriteOutcome>) =>
  new Promise<WorkWriteOutcome>((resolve) =>
    value.subscribe(
      (outcome) => {
        if (outcome.kind !== "pending") resolve(outcome);
      },
      () => {},
    ),
  );
test("the admitted criteria editor resolves Work, and host Undo resolves the firm layer again", async () => {
  const f = await createWitness(closes);
  await vi.waitFor(() => expect(f.owner.workBasis()).not.toBeNull());
  // Q2: criteria belongs to the ducts Work, through its own edit door.
  const changed = await settle(
    f.owner.invoke("edit", {
      patches: [{ path: ["criteria", "allowanceReturnInWg"], value: { edit: { value: 0.35 } } }],
      history: { label: "Return allowance" },
    }) as Observation<WorkWriteOutcome>,
  );
  expect(changed).toMatchObject({ kind: "accepted" });
  const firm = {
    version: "fixture-firm",
    criteria: {
      velocityLimitFpm: { supply: 900, return: 800 },
      terminalDropInWg: 0.03,
      autoJoinGapIn: 2,
      healBoxIn: 4,
      splitPolicy: "even" as const,
      allowanceInWg: { supply: 0.1, return: 0.2 },
    },
  };
  const current = () => {
    const work = designOf(f.owner.work()!.value as Record<string, unknown>);
    return resolveCriteria(stagedDucts(work, work), null, firm).allowanceInWg.return;
  };
  expect(current()).toMatchObject({ value: 0.35, source: "Work" });
  expect(await f.owner.history!.undo()).toMatchObject({ ok: true });
  expect(current()).toMatchObject({ value: 0.2, source: "firm" });
});
