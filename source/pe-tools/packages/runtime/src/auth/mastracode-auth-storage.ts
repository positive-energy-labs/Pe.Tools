export type MastraCodeAuthStorage = {
  loadStoredApiKeysIntoEnv?: (providers: Record<string, string>) => void;
  hasStoredApiKey?: (provider: string) => boolean;
  isLoggedIn?: (provider: string) => boolean;
};

export interface MastraCodeAuthStorageContext {
  source: "mastracode";
  storage: MastraCodeAuthStorage;
  apiKeyEnvVars: Record<string, string>;
}

export interface MastraCodeAuthStorageContextOptions {
  apiKeyEnvVars?: Record<string, string>;
  loadStoredApiKeysIntoEnv?: boolean;
}

export const defaultMastraCodeApiKeyEnvVars = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
};

export async function createMastraCodeAuthStorage(): Promise<MastraCodeAuthStorage> {
  const module = (await import("mastracode")) as {
    createAuthStorage?: () => MastraCodeAuthStorage;
  };
  if (!module.createAuthStorage) throw new Error("MastraCode auth storage is unavailable.");
  return module.createAuthStorage();
}

export async function createMastraCodeAuthStorageContext(
  options: MastraCodeAuthStorageContextOptions = {},
): Promise<MastraCodeAuthStorageContext> {
  const storage = await createMastraCodeAuthStorage();
  const apiKeyEnvVars = options.apiKeyEnvVars ?? defaultMastraCodeApiKeyEnvVars;
  if (options.loadStoredApiKeysIntoEnv !== false) {
    loadStoredMastraCodeApiKeysIntoEnv(storage, apiKeyEnvVars);
  }
  return {
    source: "mastracode",
    storage,
    apiKeyEnvVars,
  };
}

export function loadStoredMastraCodeApiKeysIntoEnv(
  authStorage: MastraCodeAuthStorage | undefined,
  providers: Record<string, string> = defaultMastraCodeApiKeyEnvVars,
): void {
  authStorage?.loadStoredApiKeysIntoEnv?.(providers);
}

export function hasMastraCodeStoredAuth(
  authStorage: MastraCodeAuthStorage | undefined,
  provider: string,
): boolean {
  return Boolean(authStorage?.hasStoredApiKey?.(provider) || authStorage?.isLoggedIn?.(provider));
}
