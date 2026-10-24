import type { CdpClient, CdpTarget } from "./cdp.ts";
import { BrowserError } from "./errors.ts";

type Endpoint = string | number;
const DISCOVERY_TIMEOUT = 10_000;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function origin(endpoint: Endpoint): URL {
  try {
    if (
      typeof endpoint === "number" &&
      (!Number.isInteger(endpoint) || endpoint < 1 || endpoint > 65535)
    ) {
      throw new Error("Port must be an integer from 1 through 65535");
    }
    const url = new URL(typeof endpoint === "number" ? `http://127.0.0.1:${endpoint}` : endpoint);
    if (url.username || url.password)
      throw new Error("Credentials are not allowed in CDP endpoints");
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("Expected HTTP or WebSocket endpoint");
    return new URL(url.origin);
  } catch (cause) {
    throw new BrowserError("InvalidArgument", "Invalid browser discovery endpoint", {
      endpoint: String(endpoint),
      outcome: "not-sent",
      cause,
    });
  }
}

async function discover(endpoint: Endpoint, path: string): Promise<unknown> {
  const url = new URL(path, origin(endpoint));
  const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT);
  try {
    const response = await fetch(url, {
      signal,
      redirect: "error",
      headers: { accept: "application/json" },
    });
    if (!response.ok)
      throw new BrowserError(
        "DiscoveryFailed",
        `Browser discovery returned HTTP ${response.status}`,
        {
          endpoint: url.href,
          outcome: "rejected",
          data: { status: response.status },
        },
      );
    try {
      return await response.json();
    } catch (cause) {
      if (signal.aborted) throw cause;
      throw new BrowserError("InvalidResponse", "Browser discovery returned invalid JSON", {
        endpoint: url.href,
        outcome: "rejected",
        cause,
      });
    }
  } catch (cause) {
    if (cause instanceof BrowserError) throw cause;
    throw new BrowserError(
      signal.aborted ? "Timeout" : "ConnectionFailed",
      signal.aborted ? "Browser discovery deadline expired" : "Browser discovery failed",
      {
        endpoint: url.href,
        outcome: "not-sent",
        cause,
      },
    );
  }
}

export async function getTargets(endpoint: Endpoint): Promise<CdpTarget[]> {
  const value = await discover(endpoint, "/json/list");
  if (
    !Array.isArray(value) ||
    !value.every(
      (target) =>
        object(target) &&
        typeof target.id === "string" &&
        typeof target.type === "string" &&
        typeof target.url === "string" &&
        typeof target.title === "string" &&
        (target.webSocketDebuggerUrl === undefined ||
          typeof target.webSocketDebuggerUrl === "string"),
    )
  ) {
    throw new BrowserError("InvalidResponse", "Browser target list has an invalid shape", {
      endpoint: String(endpoint),
      outcome: "rejected",
    });
  }
  return value as CdpTarget[];
}

export async function getBrowserEndpoint(endpoint: Endpoint): Promise<string> {
  if (typeof endpoint === "string") {
    origin(endpoint); // Validate even when no HTTP discovery is needed.
    const url = new URL(endpoint);
    if (
      ["ws:", "wss:"].includes(url.protocol) &&
      /^\/devtools\/browser\/[^/]+$/.test(url.pathname)
    ) {
      return url.href;
    }
  }
  const value = await discover(endpoint, "/json/version");
  if (object(value) && typeof value.webSocketDebuggerUrl === "string") {
    try {
      const url = new URL(value.webSocketDebuggerUrl);
      if (
        ["ws:", "wss:"].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        /^\/devtools\/browser\/[^/]+$/.test(url.pathname)
      )
        return url.href;
    } catch {
      /* The response, rather than the caller's endpoint, was malformed. */
    }
  }
  throw new BrowserError(
    "InvalidResponse",
    "Browser discovery did not return a browser WebSocket URL",
    {
      endpoint: String(endpoint),
      outcome: "rejected",
    },
  );
}

export interface ProtocolOptions {
  allowBundled?: boolean;
  /** An already connected client for this endpoint. Discovery never opens another connection. */
  client?: Pick<CdpClient, "send">;
}

export async function getProtocol(
  endpoint: Endpoint,
  options: ProtocolOptions = {},
): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await discover(endpoint, "/json/protocol");
  } catch (error) {
    // Chrome approval mode disables HTTP discovery, including /json/protocol.
    // Bundled signatures are reference documentation, never live capability evidence.
    if (
      !options.allowBundled ||
      !(error instanceof BrowserError) ||
      error.code !== "DiscoveryFailed" ||
      !object(error.data) ||
      error.data.status !== 404
    ) {
      throw error;
    }
    if (!options.client) {
      throw new BrowserError(
        "InvalidArgument",
        "Bundled protocol reference requires an existing CDP client; no new connection was opened",
        { endpoint: String(endpoint), outcome: "not-sent", cause: error },
      );
    }
    const browser = await options.client.send("Browser.getVersion");
    if (
      !object(browser) ||
      typeof browser.product !== "string" ||
      typeof browser.revision !== "string" ||
      typeof browser.protocolVersion !== "string"
    ) {
      throw new BrowserError("InvalidResponse", "Browser version has an invalid shape", {
        endpoint: String(endpoint),
        outcome: "rejected",
      });
    }
    const [browserSchema, javascriptSchema, metadata] = await Promise.all([
      import("devtools-protocol/json/browser_protocol.json", { with: { type: "json" } }),
      import("devtools-protocol/json/js_protocol.json", { with: { type: "json" } }),
      import("devtools-protocol/package.json", { with: { type: "json" } }),
    ]);
    return {
      version: { ...browserSchema.default.version },
      domains: structuredClone([
        ...browserSchema.default.domains,
        ...javascriptSchema.default.domains,
      ]),
      provenance: {
        source: "bundled-reference",
        compatibility: "unverified",
        package: metadata.default.name,
        packageVersion: metadata.default.version,
        endpoint: error.endpoint,
        httpStatus: 404,
        browser: {
          product: browser.product,
          revision: browser.revision,
          protocolVersion: browser.protocolVersion,
        },
      },
    };
  }
  if (
    !object(value) ||
    !Array.isArray(value.domains) ||
    !value.domains.every((domain) => object(domain) && typeof domain.domain === "string")
  ) {
    throw new BrowserError("InvalidResponse", "Browser protocol schema has an invalid shape", {
      endpoint: String(endpoint),
      outcome: "rejected",
    });
  }
  return {
    ...value,
    provenance: {
      source: "live-http",
      compatibility: "browser-reported",
      endpoint: new URL("/json/protocol", origin(endpoint)).href,
    },
  };
}

function entries(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(object) : [];
}

function description(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function field(value: Record<string, unknown>): string {
  const type = text(value.$ref ?? value.type);
  const array =
    value.type === "array" && object(value.items)
      ? `${text(value.items.$ref ?? value.items.type)}[]`
      : type;
  const choices = Array.isArray(value.enum) ? ` (${value.enum.map(text).join(" | ")})` : "";
  return `${text(value.name)}${value.optional ? "?" : ""}: ${array}${choices}`;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "unknown";
}

function provenanceHelp(protocol: Record<string, unknown>): string {
  const provenance = object(protocol.provenance) ? protocol.provenance : {};
  const version = object(protocol.version) ? protocol.version : {};
  if (provenance.source === "bundled-reference") {
    const browser = object(provenance.browser) ? provenance.browser : {};
    return [
      `Source: bundled-reference ${text(provenance.package)}@${text(provenance.packageVersion)}; compatibility: unverified`,
      `Browser: ${text(browser.product)}; revision: ${text(browser.revision)}; protocol: ${text(browser.protocolVersion)}`,
      `HTTP schema: ${text(provenance.endpoint)} (404). Reference documentation may differ from Chrome; raw CDP remains available.`,
    ].join("\n");
  }
  if (provenance.source === "live-http") {
    return `Source: live-http; compatibility: browser-reported\nHTTP schema: ${text(provenance.endpoint)}; protocol: ${text(version.major)}.${text(version.minor)}`;
  }
  return "Source: unspecified; compatibility: unknown";
}

/** Help always discloses its source. Reference metadata never gates raw CDP forwarding. */
export function formatProtocolHelp(protocol: Record<string, unknown>, selector?: string): string {
  const provenance = provenanceHelp(protocol);
  const missing = () =>
    new BrowserError(
      "UnknownMethod",
      `${provenance}\nProtocol reference has no documentation for ${selector ?? "the requested entry"}; raw CDP remains available.`,
      { outcome: "not-sent" },
    );
  const domains = entries(protocol.domains);
  if (!selector)
    return [
      provenance,
      ...domains.map(
        (domain) =>
          `${text(domain.domain)}${domain.description ? ` — ${description(domain.description)}` : ""}`,
      ),
    ].join("\n");
  const [domainName, commandName, extra] = selector.split(".");
  const domain = domains.find((item) => item.domain === domainName);
  if (!domain || extra !== undefined) throw missing();
  const commands = entries(domain.commands);
  const events = entries(domain.events);
  if (!commandName)
    return [
      provenance,
      `${domainName}${domain.description ? ` — ${description(domain.description)}` : ""}`,
      ...commands.map(
        (command) =>
          `${domainName}.${text(command.name)}(${entries(command.parameters).map(field).join(", ")})${command.description ? ` — ${description(command.description)}` : ""}`,
      ),
      ...events.map(
        (event) =>
          `event ${domainName}.${text(event.name)}(${entries(event.parameters).map(field).join(", ")})`,
      ),
    ].join("\n");
  const command = commands.find((item) => item.name === commandName);
  const event = events.find((item) => item.name === commandName);
  const member = command ?? event;
  if (!member) throw missing();
  return [
    provenance,
    `${command ? "" : "event "}${selector}(${entries(member.parameters).map(field).join(", ")})`,
    ...(member.description ? [description(member.description)] : []),
    ...(member.deprecated ? ["Deprecated"] : []),
    ...(member.experimental ? ["Experimental"] : []),
    ...entries(member.parameters).map(
      (parameter) =>
        `  ${field(parameter)}${parameter.description ? ` — ${description(parameter.description)}` : ""}`,
    ),
    ...(command && entries(command.returns).length
      ? [`Returns: ${entries(command.returns).map(field).join(", ")}`]
      : []),
  ].join("\n");
}
