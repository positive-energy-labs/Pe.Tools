/** Pod inventory and receipts are host contracts; acquisition belongs to the route graph. */
import type {
  PodList,
  PodMemberComposeResponse,
  PodRuns,
} from "@pe/host-contracts/operation-types";

export type PodRow = PodList["pods"][number];
export type Run = PodRuns["runs"][number];
export type Composed = PodMemberComposeResponse;
