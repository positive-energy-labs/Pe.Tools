import { expect, test } from "vite-plus/test";
import {
  createMastraGatewayRouterModel,
  createPeaCloudGatewayRuntimeAuthProfile,
  createRuntimeDescriptor,
} from "../src/index.ts";

test("exports runtime contracts", () => {
  expect(createRuntimeDescriptor("test-runtime").id).toBe("test-runtime");
});

test("describes Pea Cloud Gateway auth without provider keys by default", () => {
  const profile = createPeaCloudGatewayRuntimeAuthProfile();

  expect(profile.descriptor.source).toBe("gateway");
  expect(profile.descriptor.methods).toEqual([
    expect.objectContaining({
      id: "pea-cloud-gateway",
      kind: "agent",
    }),
  ]);
  expect(profile.descriptor.metadata).toEqual({
    gateway: "mastra",
    gatewayAuthority: "pea-cloud",
  });
});

test("creates a Mastra Gateway model router", () => {
  const model = createMastraGatewayRouterModel("openai/gpt-5.5", {
    apiKey: "test-key",
    baseUrl: "https://gateway.example.test/v1",
  });

  expect(model).toBeInstanceOf(Object);
  expect(model.gatewayId).toBe("mastra");
  expect(model.provider).toBe("openai");
  expect(model.modelId).toBe("gpt-5.5");
});
