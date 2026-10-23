import { useEffect, useRef, useState } from "react";
import { pricingClient } from "./pricing-client";
import { samePricingInput, type PricingInput, type PricingObservation } from "./pricing-job";

export function usePricing(input: PricingInput | null) {
  const client = useRef<ReturnType<typeof pricingClient> | null>(null);
  const [state, setState] = useState<{
    observation?: PricingObservation;
    error?: string;
    input: PricingInput;
  } | null>(null);
  useEffect(() => {
    if (!input) {
      client.current?.update(null);
      return;
    }
    try {
      client.current ??= pricingClient(
        new Worker(new URL("./pricing.worker.ts", import.meta.url), { type: "module" }),
        (input, response) =>
          setState(
            "result" in response
              ? { input, observation: { input, result: response.result } }
              : {
                  input,
                  error: "error" in response ? response.error : "Pricing returned no result",
                },
          ),
      );
    } catch (error) {
      setState({ input, error: String(error) });
    }
    client.current?.update(input);
  }, [input]);
  useEffect(
    () => () => {
      client.current?.stop();
      client.current = null;
    },
    [],
  );
  const current = !!input && !!state && samePricingInput(input, state.input);
  return {
    observation: current ? (state.observation ?? null) : null,
    error: current ? (state.error ?? null) : null,
  };
}
