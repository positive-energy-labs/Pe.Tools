import type { z } from "zod";
import { peRoutes } from "../../../../packages/mcps/src/pea/product-catalog.generated.ts";
import { peClient } from "./pe-client";
export type Feedback = z.input<(typeof peRoutes)["feedback.submit"]["body"]>;
export type FeedbackReceipt = z.output<(typeof peRoutes)["feedback.submit"]["output"]>;
/** Kept and delivered are different facts; uncertain delivery never resubmits the note. */
export const sendFeedback = (body: Feedback) => peClient.call("feedback.submit", { body });
export const deliverFeedback = (id: string) =>
  peClient.call("feedback.deliver", { params: { id } });
