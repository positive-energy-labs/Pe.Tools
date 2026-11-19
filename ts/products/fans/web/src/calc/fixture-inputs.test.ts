import { designOf } from "@pe/ducts-domain/test-design";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { stagedDucts } from "@pe/duct-systems-contract/ducts";
import { resolveCriteria } from "@pe/fans-domain/calc/index";
import { createWitness } from "@pe/fans-web/cutover.test-support";
import type {
  Observation,
  WorkWriteOutcome,
} from "../../../../../packages/agent-contracts/src/work-journal-door.ts";
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
    const { criteria, criteriaMeta } = stagedDucts(work, work);
    return resolveCriteria({ criteria, criteriaMeta }, firm).allowanceInWg.return;
  };
  expect(current()).toMatchObject({ value: 0.35, source: "Work" });
  await vi.waitFor(() => expect(f.owner.timeline()?.undo).toBeTruthy());
  expect(await f.owner.stepTimeline("undo")).toBeNull();
  expect(current()).toMatchObject({ value: 0.2, source: "firm" });
});
