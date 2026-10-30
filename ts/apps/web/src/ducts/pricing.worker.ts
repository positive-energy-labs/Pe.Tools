import { pricingJob, type PricingPayload } from "./pricing-job";
import type { ReadingWorkerRequest } from "#/shell/readings-worker";
import type { PricingResult } from "./pricing-job";
import { pricingDelta } from "./pricing-delta";

const run = pricingJob();
let previous: PricingResult | undefined;
self.onmessage = (event: MessageEvent<ReadingWorkerRequest<PricingPayload>>) => {
  const { id, input } = event.data;
  const response = run({ id, ...input });
  if (!("result" in response)) return self.postMessage(response);
  const delta = pricingDelta(previous, response.result) ?? null;
  previous = response.result;
  self.postMessage({ id: response.id, delta });
};
