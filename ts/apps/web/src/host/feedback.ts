import { z } from "zod";

import { hostFetch } from "#/host/runtime";
import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

/** An explicit human note: the one export that keeps its content (the software-factory signal). */
export type Feedback = {
  comment: string;
  url: string;
  selector: string | null;
  component: string | null;
  components: string[];
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number; dpr: number };
  picture: string | null;
  picture_error: string | null;
};

/**
 * The host keeps the note first and hands it to PostHog second. Kept and delivered are two facts:
 * `failed` means PostHog was not given the note; `uncertain` means a send may have landed or is still
 * in flight. Either way the note is on this host under `feedbackId` and delivering it again names the
 * same note.
 */
const feedbackReceiptSchema = z.discriminatedUnion("delivery", [
  z.strictObject({ feedbackId: z.uuid(), delivery: z.literal("accepted") }),
  z.strictObject({
    feedbackId: z.uuid(),
    delivery: z.enum(["failed", "uncertain"]),
    error: z.string(),
  }),
]);
export type FeedbackReceipt = z.infer<typeof feedbackReceiptSchema>;

async function receiptOf(response: Response): Promise<FeedbackReceipt> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(body?.error ?? `feedback refused (${response.status})`);
  const receipt = feedbackReceiptSchema.safeParse(body);
  if (!receipt.success) throw new Error("The host answered without a feedback receipt.");
  return receipt.data;
}

const post = (path: string, body?: unknown) =>
  hostFetch(peUrl(resolveWorkbenchConfig(), path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** Throws only when the host refused or never kept the note; a kept note returns its receipt. */
export const sendFeedback = async (feedback: Feedback) =>
  receiptOf(await post("/feedback", feedback));

/** Deliver a note this host already keeps; never resubmits its content from the browser. */
export const deliverFeedback = async (feedbackId: string) =>
  receiptOf(await post(`/feedback/${encodeURIComponent(feedbackId)}/deliver`));
