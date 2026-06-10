import {
  MastraGateway,
  ModelRouterLanguageModel,
  type GatewayLanguageModel,
  type MastraGatewayConfig,
} from "@mastra/core/llm";

export interface MastraGatewayRouterModelOptions extends MastraGatewayConfig {
  headers?: Record<string, string>;
}

export function createMastraGatewayRouterModel(
  modelId: string,
  options: MastraGatewayRouterModelOptions = {},
): ModelRouterLanguageModel {
  const routerModelId = modelId.startsWith("mastra/") ? modelId : `mastra/${modelId}`;
  const { headers, ...gatewayConfig } = options;

  return new ModelRouterLanguageModel(
    {
      id: routerModelId as `mastra/${string}/${string}`,
      apiKey: gatewayConfig.apiKey,
      headers,
    },
    [new MastraGateway(gatewayConfig)],
  );
}

export type RuntimeLanguageModel = GatewayLanguageModel | ModelRouterLanguageModel;
