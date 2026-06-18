import {
  MastraGateway,
  ModelRouterLanguageModel,
  type GatewayLanguageModel,
  type MastraGatewayConfig,
} from "@mastra/core/llm";

export interface MastraGatewayRouterModelOptions extends MastraGatewayConfig {
  headers?: Record<string, string>;
}

type MastraRouterModelId = `mastra/${string}/${string}`;

export function createMastraGatewayRouterModel(
  modelId: string,
  options: MastraGatewayRouterModelOptions = {},
): ModelRouterLanguageModel {
  const routerModelId = resolveMastraRouterModelId(modelId);
  const { headers, ...gatewayConfig } = options;

  return new ModelRouterLanguageModel(
    {
      id: routerModelId,
      apiKey: gatewayConfig.apiKey,
      headers,
    },
    [new MastraGateway(gatewayConfig)],
  );
}

export type RuntimeLanguageModel = GatewayLanguageModel | ModelRouterLanguageModel;

function resolveMastraRouterModelId(modelId: string): MastraRouterModelId {
  const routerModelId = modelId.startsWith("mastra/") ? modelId : `mastra/${modelId}`;
  if (isMastraRouterModelId(routerModelId)) return routerModelId;
  throw new Error(`Invalid Mastra gateway model id: ${modelId}`);
}

function isMastraRouterModelId(value: string): value is MastraRouterModelId {
  return /^mastra\/[^/]+\/.+/.test(value);
}
