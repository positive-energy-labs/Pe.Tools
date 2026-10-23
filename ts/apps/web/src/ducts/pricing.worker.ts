import { pricingJob, type PricingRequest } from "./pricing-job";
import type { PricingResult } from "./pricing-job";
import { pricingDelta } from "./pricing-delta";

const run = pricingJob();
let previous: PricingResult | undefined;
self.onmessage = (event: MessageEvent<PricingRequest>) => {
  const response = run(event.data);
  if (!("result" in response)) return self.postMessage(response);
  const delta = pricingDelta(previous, response.result) ?? null;
  previous = response.result;
  self.postMessage({ id: response.id, delta });
};
