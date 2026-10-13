import { expect, test } from "vite-plus/test";
import { classifyEndpointFailure } from "../src/harness/endpoint-failure.ts";

test("ACP error data retains the provider body behind its generic message", () => {
  const error = Object.assign(new Error("Internal error"), {
    data: {
      error: {
        type: "invalid_request_error",
        message: "Your credit balance is too low to access the Anthropic API.",
      },
    },
  });
  const failure = classifyEndpointFailure(error);
  expect(failure.kind).toBe("billing");
  expect(failure.raw).toContain(JSON.stringify(error.data));
});

test.each([
  [
    400,
    {
      type: "error",
      error: {
        type: "invalid_request_error",
        message:
          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
      },
      request_id: "req_test",
    },
  ],
  [
    429,
    {
      error: {
        message: "You exceeded your current quota, please check your plan and billing details.",
        type: "insufficient_quota",
        param: null,
        code: "insufficient_quota",
      },
    },
  ],
])("classifies a real-shaped credit refusal at HTTP %s and preserves its body", (status, body) => {
  const raw = JSON.stringify(body);
  expect(classifyEndpointFailure(raw, status)).toEqual({
    kind: "billing",
    message: "billing: Out of credit or billing limit reached.",
    raw,
  });
});
test.each([
  [401, '{"error":{"code":"invalid_api_key"}}', "auth"],
  [404, '{"error":{"code":"model_not_found"}}', "model"],
  [undefined, "TypeError: fetch failed", "unreachable"],
  [503, "upstream unavailable", "unreachable"],
  [400, "invalid request\nnot understood", "other"],
  [429, '{"error":{"type":"rate_limit_error"}}', "other"],
])("classifies %s %s without putting raw data on the line", (status, raw, kind) => {
  const result = classifyEndpointFailure(raw, status);
  expect(result.kind).toBe(kind);
  expect(result.message).not.toContain("\n");
  expect(result.message).not.toContain("{");
  expect(result.raw).toBe(raw);
});
