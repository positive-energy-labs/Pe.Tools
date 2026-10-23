import {
  samePricingInput,
  type PricingInput,
  type PricingRequest,
  type PricingResponse,
  type PricingResult,
} from "./pricing-job";
import { applyPricingDelta } from "./pricing-delta";

export interface PricingPort {
  postMessage: (request: PricingRequest) => void;
  terminate: () => void;
  onmessage: ((event: MessageEvent<PricingResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

/** One running solve and one latest request: rapid edits never queue obsolete whole-document solves. */
export function pricingClient(
  worker: PricingPort,
  publish: (input: PricingInput, response: PricingResponse) => void,
) {
  let latest: PricingInput | null = null;
  let running: { id: number; input: PricingInput } | null = null;
  let sentBase: PricingInput | null = null;
  let sequence = 0;
  let stopped = false;
  let decoded: PricingResult | undefined;
  let failure: string | null = null;
  const send = () => {
    if (stopped || running || !latest) return;
    const input = latest;
    const changed =
      !sentBase ||
      sentBase.snapshot !== input.snapshot ||
      sentBase.grids !== input.grids ||
      sentBase.catalogs !== input.catalogs;
    const id = ++sequence;
    running = { id, input };
    try {
      worker.postMessage({
        id,
        doc: input.doc,
        ...(changed
          ? {
              base: { snapshot: input.snapshot, grids: input.grids, catalogs: input.catalogs },
            }
          : {}),
      });
      sentBase = input;
    } catch (error) {
      running = null;
      publish(input, { id, error: String(error) });
    }
  };
  worker.onmessage = ({ data }) => {
    if (stopped || !running || data.id !== running.id) return;
    const input = running.input;
    running = null;
    // Even an obsolete answer advances the delta base, without becoming a displayed observation.
    if ("delta" in data)
      decoded = data.delta ? (applyPricingDelta(decoded, data.delta) as PricingResult) : decoded;
    const response =
      "delta" in data
        ? decoded
          ? { id: data.id, result: decoded }
          : { id: data.id, error: "Pricing returned no result" }
        : data;
    if (latest && samePricingInput(input, latest)) publish(latest, response);
    else send();
  };
  worker.onerror = (event) => {
    if (stopped) return;
    failure = event.message || "Pricing worker failed";
    if (latest) publish(latest, { id: running?.id ?? sequence, error: failure });
    running = null;
    stopped = true;
    worker.terminate();
  };
  return {
    update(input: PricingInput | null) {
      latest = input;
      if (failure && input) publish(input, { id: sequence, error: failure });
      else send();
    },
    stop() {
      stopped = true;
      latest = null;
      worker.terminate();
    },
  };
}
