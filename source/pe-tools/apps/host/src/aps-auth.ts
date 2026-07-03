import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Effect, FileSystem, Schema, Semaphore } from "effect";
import { HttpBody, HttpClient, UrlParams } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { productIdentity, productPathNames } from "@pe/host-contracts/contracts";
import {
  ApsAuthFlowKind,
  ApsScopeProfile,
  type ApsLogoutResult,
  type ApsPersistedTokenStatus,
  type ApsTokenRequest,
  type ApsTokenResult,
} from "@pe/host-contracts/effect";
import { LocalOpError } from "./local-error.ts";
import { productGlobalSettingsPath } from "./product-paths.ts";

const APS_AUTH_BASE_URL = "https://developer.api.autodesk.com/authentication/v2";
const CALLBACK_PORT = 8080;
const CALLBACK_URI = `http://localhost:${CALLBACK_PORT}/api/aps/callback/oauth`;
const EXPIRATION_BUFFER_SECONDS = 60;
const DEFAULT_EXPIRATION_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 15_000;
const INTERACTIVE_TIMEOUT_MS = 5 * 60_000;
const tokenStoreLock = Semaphore.makeUnsafe(1);

type ApsAuthEffect<A> = Effect.Effect<
  A,
  LocalOpError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | HttpClient.HttpClient
>;

type NormalizedApsTokenRequest = {
  readonly explicitScopes: readonly string[] | null;
  readonly flowKind: ApsAuthFlowKind;
  readonly scopeProfile: ApsScopeProfile;
};

type ApsCredentials = {
  readonly clientId: string;
  readonly clientSecret: string | null;
};

const persistedTokenRecordSchema = Schema.Struct({
  accessToken: Schema.String,
  expiresAtUtc: Schema.String,
  refreshToken: Schema.optional(Schema.String),
});

type PersistedTokenRecord = Schema.Schema.Type<typeof persistedTokenRecordSchema> & {
  readonly refreshToken: string;
};

const persistedTokenFileSchema = Schema.Struct({
  entries: Schema.optional(
    Schema.Array(
      Schema.Struct({
        key: Schema.optional(Schema.String),
        protectedPayload: Schema.optional(Schema.String),
      }),
    ),
  ),
});

type ApsTokenResponse = {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_at?: unknown;
  readonly expires_in?: unknown;
};

type AuthorizationCallback = {
  readonly code: string | null;
  readonly state: string | null;
  readonly error: string | null;
  readonly errorDescription: string | null;
};

const sharedDelegatedUserScopes = normalizeScopes([
  "account:read",
  "bucket:read",
  "code:all",
  "data:create",
  "data:read",
  "data:write",
]);

const scopeProfiles = {
  [ApsScopeProfile.ParameterService]: sharedDelegatedUserScopes,
  [ApsScopeProfile.AutomationManagement]: normalizeScopes(["code:all"]),
  [ApsScopeProfile.AutomationUserContext]: sharedDelegatedUserScopes,
  [ApsScopeProfile.AutomationArtifactStorage]: normalizeScopes([
    "bucket:create",
    "bucket:read",
    "data:read",
    "data:write",
  ]),
} satisfies Record<ApsScopeProfile, readonly string[]>;

export const apsAuthStatus: (input: ApsTokenRequest) => ApsAuthEffect<ApsPersistedTokenStatus> =
  Effect.fnUntraced(function* (input: ApsTokenRequest) {
    return yield* tokenStoreLock.withPermit(
      Effect.gen(function* () {
        const request = normalizeApsTokenRequest(input);
        const credentials = yield* readApsCredentials("aps.auth.status", false);
        const token = yield* loadPersistedToken(
          createApsTokenStoreKey(credentials.clientId, request),
        );
        return toPersistedTokenStatus(request, token);
      }),
    );
  });

export const apsAuthLogin: (input: ApsTokenRequest) => ApsAuthEffect<ApsPersistedTokenStatus> =
  Effect.fnUntraced(function* (input: ApsTokenRequest) {
    yield* apsAuthToken(input);
    return yield* apsAuthStatus(input);
  });

export const apsAuthLogout: () => ApsAuthEffect<ApsLogoutResult> = Effect.fnUntraced(function* () {
  return yield* tokenStoreLock.withPermit(
    Effect.gen(function* () {
      const credentials = yield* readApsCredentials("aps.auth.logout", false);
      yield* deletePersistedTokensByClientId(credentials.clientId);
      return { loggedOut: true } satisfies ApsLogoutResult;
    }),
  );
});

export const apsAuthToken: (input: ApsTokenRequest) => ApsAuthEffect<ApsTokenResult> =
  Effect.fnUntraced(function* (input: ApsTokenRequest) {
    return yield* tokenStoreLock.withPermit(
      Effect.gen(function* () {
        const request = normalizeApsTokenRequest(input);
        const credentials = yield* readApsCredentials("aps.auth.token", true);
        const tokenKey = createApsTokenStoreKey(credentials.clientId, request);
        const current = yield* loadPersistedToken(tokenKey);
        if (current && isTokenFresh(current)) return toTokenResult(request, current);

        if (request.flowKind === ApsAuthFlowKind.ThreeLeggedConfidential && current?.refreshToken) {
          const refreshed = yield* Effect.result(
            refreshApsToken(credentials, request, current.refreshToken),
          );
          if (refreshed._tag === "Success") {
            yield* savePersistedToken(tokenKey, refreshed.success);
            return toTokenResult(request, refreshed.success);
          }
        }

        const token =
          request.flowKind === ApsAuthFlowKind.TwoLegged
            ? yield* acquireClientCredentialsToken(credentials, request)
            : yield* acquireInteractiveToken(credentials, request);
        yield* savePersistedToken(tokenKey, token);
        return toTokenResult(request, token);
      }),
    );
  });

export function normalizeApsTokenRequest(input: ApsTokenRequest): NormalizedApsTokenRequest {
  return {
    explicitScopes: input.explicitScopes ? normalizeScopes(input.explicitScopes) : null,
    flowKind: input.flowKind ?? ApsAuthFlowKind.ThreeLeggedConfidential,
    scopeProfile: input.scopeProfile ?? ApsScopeProfile.ParameterService,
  };
}

export function resolveApsScopes(request: NormalizedApsTokenRequest): readonly string[] {
  return request.explicitScopes?.length
    ? request.explicitScopes
    : scopeProfiles[request.scopeProfile];
}

export function createApsTokenStoreKey(
  clientId: string,
  request: NormalizedApsTokenRequest,
): string {
  return [clientId, request.flowKind, resolveApsScopes(request).join(" ")].join("|");
}

function normalizeScopes(scopes: readonly string[]): readonly string[] {
  return [
    ...new Map(
      scopes
        .map((scope) => scope.trim())
        .filter(Boolean)
        .map((scope) => [scope.toLowerCase(), scope] as const),
    ).values(),
  ].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "accent" }));
}

function toPersistedTokenStatus(
  request: NormalizedApsTokenRequest,
  token: PersistedTokenRecord | null,
): ApsPersistedTokenStatus {
  return {
    exists: token != null,
    expiresAtUtc: token?.expiresAtUtc ?? null,
    flowKind: request.flowKind,
    hasRefreshToken: Boolean(token?.refreshToken),
    scopeProfile: request.scopeProfile,
  };
}

function toTokenResult(
  request: NormalizedApsTokenRequest,
  token: PersistedTokenRecord,
): ApsTokenResult {
  return {
    accessToken: token.accessToken,
    expiresAtUtc: token.expiresAtUtc,
    flowKind: request.flowKind,
    refreshToken: token.refreshToken || null,
    scopeProfile: request.scopeProfile,
  };
}

function isTokenFresh(token: PersistedTokenRecord): boolean {
  return Date.now() < new Date(token.expiresAtUtc).getTime() - EXPIRATION_BUFFER_SECONDS * 1000;
}

const acquireClientCredentialsToken = Effect.fnUntraced(function* (
  credentials: ApsCredentials,
  request: NormalizedApsTokenRequest,
) {
  const response = yield* requestToken("aps.auth.token", credentials, {
    grant_type: "client_credentials",
    scope: resolveApsScopes(request).join(" "),
  });
  return yield* parseTokenResponse("aps.auth.token", response);
});

const refreshApsToken = Effect.fnUntraced(function* (
  credentials: ApsCredentials,
  request: NormalizedApsTokenRequest,
  refreshToken: string,
) {
  const response = yield* requestToken("aps.auth.token", credentials, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: resolveApsScopes(request).join(" "),
  });
  return yield* parseTokenResponse("aps.auth.token", response, refreshToken);
});

const acquireInteractiveToken = Effect.fnUntraced(function* (
  credentials: ApsCredentials,
  request: NormalizedApsTokenRequest,
) {
  const state = randomUUID().replace(/-/g, "");
  const callback = yield* Effect.scoped(
    Effect.gen(function* () {
      const listener = yield* Effect.acquireRelease(
        Effect.sync(() => createCallbackListener()),
        (listener) => Effect.sync(() => listener.close()),
      );
      yield* Effect.tryPromise({
        try: () => listener.ready,
        catch: (error) => new LocalOpError("aps.auth.login", errorMessage(error)),
      });
      yield* openBrowser(buildAuthorizeUrl(credentials.clientId, request, state));
      return yield* Effect.tryPromise({
        try: () => listener.callback,
        catch: (error) => new LocalOpError("aps.auth.login", errorMessage(error)),
      });
    }),
  );

  if (callback.error)
    return yield* Effect.fail(
      new LocalOpError("aps.auth.login", callback.errorDescription ?? callback.error),
    );
  if (callback.state !== state)
    return yield* Effect.fail(
      new LocalOpError("aps.auth.login", "APS authorization callback state did not match."),
    );
  if (!callback.code)
    return yield* Effect.fail(
      new LocalOpError("aps.auth.login", "APS authorization callback did not include a code."),
    );

  const response = yield* requestToken("aps.auth.login", credentials, {
    code: callback.code,
    grant_type: "authorization_code",
    redirect_uri: CALLBACK_URI,
  });
  return yield* parseTokenResponse("aps.auth.login", response);
});

function buildAuthorizeUrl(
  clientId: string,
  request: NormalizedApsTokenRequest,
  state: string,
): string {
  const url = new URL(`${APS_AUTH_BASE_URL}/authorize`);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CALLBACK_URI,
    response_type: "code",
    scope: resolveApsScopes(request).join(" "),
    state,
  }).toString();
  return url.toString();
}

const requestToken = Effect.fnUntraced(function* (
  operationKey: string,
  credentials: ApsCredentials,
  form: Record<string, string>,
) {
  if (!credentials.clientSecret)
    return yield* Effect.fail(
      new LocalOpError(operationKey, "APS web client secret is not configured."),
    );

  const response = yield* HttpClient.post(`${APS_AUTH_BASE_URL}/token`, {
    body: HttpBody.urlParams(UrlParams.fromInput(form)),
    headers: {
      authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
    },
  }).pipe(
    Effect.timeout(REQUEST_TIMEOUT_MS),
    Effect.mapError((error) => new LocalOpError(operationKey, errorMessage(error))),
  );
  const text = yield* response.text.pipe(
    Effect.mapError((error) => new LocalOpError(operationKey, errorMessage(error))),
  );
  if (response.status < 200 || response.status >= 300)
    return yield* Effect.fail(
      new LocalOpError(
        operationKey,
        `APS token request failed (${response.status}): ${readApsError(text)}`,
      ),
    );
  return yield* Effect.try({
    try: () => JSON.parse(text) as ApsTokenResponse,
    catch: (error) => new LocalOpError(operationKey, errorMessage(error)),
  });
});

function toPersistedTokenRecord(
  response: ApsTokenResponse,
  fallbackRefreshToken = "",
): PersistedTokenRecord {
  if (typeof response.access_token !== "string" || !response.access_token)
    throw new Error("APS token response did not include an access token.");
  return {
    accessToken: response.access_token,
    refreshToken:
      typeof response.refresh_token === "string" ? response.refresh_token : fallbackRefreshToken,
    expiresAtUtc: resolveExpiryUtc(response).toISOString(),
  };
}

const parseTokenResponse = Effect.fnUntraced(function* (
  operationKey: string,
  response: ApsTokenResponse,
  fallbackRefreshToken = "",
) {
  return yield* Effect.try({
    try: () => toPersistedTokenRecord(response, fallbackRefreshToken),
    catch: (error) => new LocalOpError(operationKey, errorMessage(error)),
  });
});

function resolveExpiryUtc(response: ApsTokenResponse): Date {
  const expiresAt = Number(response.expires_at);
  if (Number.isFinite(expiresAt) && expiresAt > 0) return new Date(expiresAt * 1000);
  const expiresIn = Number(response.expires_in);
  return new Date(
    Date.now() + (Number.isFinite(expiresIn) ? expiresIn : DEFAULT_EXPIRATION_SECONDS) * 1000,
  );
}

function readApsError(text: string): string {
  if (!text) return "empty response";
  try {
    const body = JSON.parse(text) as {
      error_description?: unknown;
      error?: unknown;
      detail?: unknown;
    };
    const detail = body.error_description ?? body.detail ?? body.error;
    return typeof detail === "string" ? detail : detail == null ? text : JSON.stringify(detail);
  } catch {
    return text;
  }
}

const readApsCredentials = Effect.fnUntraced(function* (
  operationKey: string,
  requireSecret: boolean,
) {
  const settingsPath = globalSettingsPath();
  const fs = yield* FileSystem.FileSystem;
  const contentResult = yield* Effect.result(fs.readFileString(settingsPath));
  if (contentResult._tag === "Failure")
    return yield* Effect.fail(
      new LocalOpError(operationKey, `APS settings were not found at '${settingsPath}'.`),
    );

  const settings = yield* Effect.try({
    try: () => JSON.parse(contentResult.success) as Record<string, unknown>,
    catch: (error) =>
      new LocalOpError(
        operationKey,
        `Failed to read APS settings from '${settingsPath}': ${errorMessage(error)}`,
      ),
  });
  const clientId =
    typeof settings.ApsWebClientId1 === "string" && settings.ApsWebClientId1.trim()
      ? settings.ApsWebClientId1.trim()
      : null;
  if (!clientId)
    return yield* Effect.fail(
      new LocalOpError(operationKey, `ApsWebClientId1 is not configured in '${settingsPath}'.`),
    );
  const clientSecret =
    typeof settings.ApsWebClientSecret1 === "string" && settings.ApsWebClientSecret1.trim()
      ? settings.ApsWebClientSecret1.trim()
      : null;
  if (requireSecret && !clientSecret)
    return yield* Effect.fail(
      new LocalOpError(
        operationKey,
        `APS web client secret is not configured in '${settingsPath}'.`,
      ),
    );
  return { clientId, clientSecret } satisfies ApsCredentials;
});

function globalSettingsPath(): string {
  return productGlobalSettingsPath();
}

function tokenStorePath(): string {
  return join(
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
    productIdentity.vendorName,
    productIdentity.productName,
    productPathNames.stateDirectoryName,
    "aps-auth",
    "tokens.json",
  );
}

const loadPersistedToken = Effect.fnUntraced(function* (key: string) {
  const map = yield* loadPersistedTokenMap();
  return map.get(key) ?? null;
});

const savePersistedToken = Effect.fnUntraced(function* (key: string, token: PersistedTokenRecord) {
  const map = yield* loadPersistedTokenMap();
  map.set(key, token);
  yield* writePersistedTokenMap(map);
});

const deletePersistedTokensByClientId = Effect.fnUntraced(function* (clientId: string) {
  const map = yield* loadPersistedTokenMap();
  for (const key of map.keys())
    if (key.toLowerCase().startsWith(`${clientId.toLowerCase()}|`)) map.delete(key);
  yield* writePersistedTokenMap(map);
});

const loadPersistedTokenMap = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const fileResult = yield* Effect.result(fs.readFileString(tokenStorePath()));
  if (fileResult._tag === "Failure" || !fileResult.success.trim())
    return new Map<string, PersistedTokenRecord>();

  const file = yield* Effect.try({
    try: () => JSON.parse(fileResult.success) as unknown,
    catch: (error) => new LocalOpError("aps.auth.token", errorMessage(error)),
  }).pipe(
    Effect.flatMap((parsed) => Schema.decodeUnknownEffect(persistedTokenFileSchema)(parsed)),
    Effect.mapError((error) => new LocalOpError("aps.auth.token", errorMessage(error))),
  );
  const map = new Map<string, PersistedTokenRecord>();
  for (const entry of file.entries ?? []) {
    if (!entry.key || !entry.protectedPayload) continue;
    const record = yield* Effect.result(unprotectUserSecret(entry.protectedPayload));
    if (record._tag !== "Success") continue;
    const parsed = parsePersistedTokenRecord(record.success);
    if (parsed) map.set(entry.key, parsed);
  }
  return map;
});

function parsePersistedTokenRecord(value: string): PersistedTokenRecord | null {
  try {
    const parsed = Schema.decodeUnknownSync(persistedTokenRecordSchema)(JSON.parse(value));
    return {
      accessToken: parsed.accessToken,
      expiresAtUtc: parsed.expiresAtUtc,
      refreshToken: parsed.refreshToken ?? "",
    };
  } catch {
    return null;
  }
}

const writePersistedTokenMap = Effect.fnUntraced(function* (
  map: ReadonlyMap<string, PersistedTokenRecord>,
) {
  const entries = yield* Effect.all(
    [...map.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, record]) =>
        protectUserSecret(JSON.stringify(record)).pipe(
          Effect.map((protectedPayload) => ({ key, protectedPayload })),
        ),
      ),
  );
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .makeDirectory(dirname(tokenStorePath()), { recursive: true })
    .pipe(Effect.mapError((error) => new LocalOpError("aps.auth.token", error.message)));
  yield* fs
    .writeFileString(tokenStorePath(), `${JSON.stringify({ entries }, null, 2)}\n`)
    .pipe(Effect.mapError((error) => new LocalOpError("aps.auth.token", error.message)));
});

const protectUserSecret = Effect.fnUntraced(function* (plainText: string) {
  return yield* runPowershell(
    "aps.auth.token",
    "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect([Convert]::FromBase64String($inputArgs[0]), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))",
    [Buffer.from(plainText, "utf8").toString("base64")],
  );
});

const unprotectUserSecret = Effect.fnUntraced(function* (protectedPayload: string) {
  const base64 = yield* runPowershell(
    "aps.auth.token",
    "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($inputArgs[0]), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))",
    [protectedPayload],
  );
  return Buffer.from(base64, "base64").toString("utf8");
});

const runPowershell = Effect.fnUntraced(function* (
  operationKey: string,
  command: string,
  args: readonly string[],
) {
  if (process.platform !== "win32")
    return yield* Effect.fail(
      new LocalOpError(operationKey, "APS token persistence requires Windows DPAPI."),
    );
  const inputArgs = args.map((arg) => `'${arg.replaceAll("'", "''")}'`).join(", ");
  const encodedCommand = Buffer.from(
    `$inputArgs = @(${inputArgs})\n${command}`,
    "utf16le",
  ).toString("base64");
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* spawner
    .string(
      ChildProcess.make("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodedCommand,
      ]),
    )
    .pipe(Effect.mapError((error) => new LocalOpError(operationKey, errorMessage(error))));
  const trimmed = output.trim();
  if (!trimmed)
    return yield* Effect.fail(
      new LocalOpError(operationKey, "PowerShell command produced no output."),
    );
  return trimmed;
});

const openBrowser = Effect.fnUntraced(function* (url: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  yield* spawner
    .string(ChildProcess.make("rundll32.exe", ["url.dll,FileProtocolHandler", url]))
    .pipe(Effect.mapError((error) => new LocalOpError("aps.auth.login", errorMessage(error))));
});

function createCallbackListener(): {
  readonly ready: Promise<void>;
  readonly callback: Promise<AuthorizationCallback>;
  readonly close: () => void;
} {
  let server: Server | null = null;
  let settled = false;
  let timer: NodeJS.Timeout | null = null;

  const close = () => {
    if (timer) clearTimeout(timer);
    server?.close();
    server = null;
  };

  const callback = new Promise<AuthorizationCallback>((resolve, reject) => {
    const finish = (result: AuthorizationCallback | Error) => {
      if (settled) return;
      settled = true;
      close();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    server = createServer((req, res) => {
      const parsed = new URL(req.url ?? "/", CALLBACK_URI);
      if (req.method !== "GET" || parsed.pathname !== new URL(CALLBACK_URI).pathname) {
        res.writeHead(404, { connection: "close" });
        res.end();
        return;
      }
      const result: AuthorizationCallback = {
        code: parsed.searchParams.get("code"),
        state: parsed.searchParams.get("state"),
        error: parsed.searchParams.get("error"),
        errorDescription: parsed.searchParams.get("error_description"),
      };
      const ok = !result.error;
      const body = ok
        ? "<html><body><h2>APS authentication complete</h2><p>You can close this window.</p></body></html>"
        : `<html><body><h2>APS authentication failed</h2><p>${escapeHtml(result.errorDescription ?? result.error ?? "")}</p></body></html>`;
      res.writeHead(200, {
        connection: "close",
        "content-length": Buffer.byteLength(body),
        "content-type": "text/html; charset=UTF-8",
      });
      res.end(body, () => finish(result));
    });
    server.on("error", (error) => finish(error));
    timer = setTimeout(
      () => finish(new Error("Timed out waiting for APS authorization callback.")),
      INTERACTIVE_TIMEOUT_MS,
    );
  });

  const ready = new Promise<void>((resolve, reject) => {
    server?.once("listening", () => resolve());
    server?.once("error", reject);
    server?.listen(CALLBACK_PORT, "127.0.0.1");
  });

  return { ready, callback, close };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
