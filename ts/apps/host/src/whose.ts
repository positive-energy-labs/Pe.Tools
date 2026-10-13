import {
  instancesLaunchSchema,
  instancesStartSchema,
  type ActionReceipt,
} from "@pe/agent-contracts";
import { z } from "zod";

const startedProcess = z.object({
  session: z.object({ process: z.object({ pid: z.number(), processStartUtc: z.string() }) }),
});
const openedProcess = z.object({ session: startedProcess });

/** A background posture alone never makes a user's Revit Pea's. */
export function whoseOf(
  session: { posture: string; process: { pid: number; processStartUtc: string } | null },
  receipts: readonly ActionReceipt[],
): "you" | "pea" {
  const expected = session.process;
  if (session.posture !== "background" || !expected) return "you";
  return receipts.some((receipt) => {
    if (receipt.state !== "succeeded" || receipt.kind !== "workflow") return false;
    const start =
      receipt.key === "instances.start"
        ? instancesStartSchema.safeParse(receipt.request).data
        : receipt.key === "instances.open"
          ? instancesLaunchSchema.safeParse(receipt.request).data?.into
          : null;
    const owner =
      start && "start" in start
        ? start.start.owner
        : start && "owner" in start
          ? start.owner
          : null;
    if (owner !== "pea") return false;
    const result =
      receipt.key === "instances.start"
        ? startedProcess.safeParse(receipt.result)
        : openedProcess.safeParse(receipt.result);
    if (!result.success) return false;
    const value = result.data.session;
    const process = "process" in value ? value.process : value.session.process;
    return process.pid === expected.pid && process.processStartUtc === expected.processStartUtc;
  })
    ? "pea"
    : "you";
}
