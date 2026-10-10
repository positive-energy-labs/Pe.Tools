import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { invocationContext } from "@pe/mcps/context";
import type { MachineShare } from "@pe/agent-contracts";
import type { IdentityResult } from "./request-identity.ts";

type Mapping = { authority: string; target: string };
type Intent = {
  desired: "on" | "off";
  mapping: Mapping | null;
  allowRemoteAdministration?: boolean;
};
type ServeStatus = {
  TCP?: Record<string, unknown>;
  Web?: Record<string, { Handlers?: Record<string, unknown> }>;
  AllowFunnel?: Record<string, boolean>;
};
export interface ShareOptions {
  readonly installed: boolean;
  readonly port: () => number;
  readonly run: (args: readonly string[]) => Promise<string>;
  readonly load: () => Promise<Intent | null>;
  readonly save: (intent: Intent) => Promise<void>;
  readonly now?: () => string;
}

export function tailscaleCommand(binary = "tailscale", prefix: readonly string[] = []) {
  return (args: readonly string[]): Promise<string> =>
    new Promise((resolve, reject) =>
      execFile(
        binary,
        [...prefix, ...args],
        { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
        (error, stdout) => (error ? reject(error) : resolve(stdout)),
      ),
    );
}

export function shareIntentFile(path: string): Pick<ShareOptions, "load" | "save"> {
  return {
    async load() {
      try {
        const value = JSON.parse(await readFile(path, "utf8")) as Intent;
        if (
          (value.desired !== "on" && value.desired !== "off") ||
          (value.allowRemoteAdministration !== undefined &&
            typeof value.allowRemoteAdministration !== "boolean") ||
          (value.mapping !== null &&
            (typeof value.mapping?.authority !== "string" ||
              typeof value.mapping?.target !== "string"))
        )
          throw Error("Invalid installed share intent");
        return value;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(value) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path + ".tmp", JSON.stringify(value));
      await rename(path + ".tmp", path);
    },
  };
}

export function createShare(options: ShareOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const listeners = new Set<() => void>();
  let intent: Intent = { desired: "off", mapping: null };
  let state: MachineShare = {
    allowRemoteAdministration: true,
    desired: "off",
    state: "unknown",
    url: null,
    refusal: null,
    callers: [],
    refused: [],
  };
  let serial = Promise.resolve();
  let checkedAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<MachineShare> | undefined;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const refused = (code: string, detail: string) => {
    state = {
      ...state,
      allowRemoteAdministration: intent.allowRemoteAdministration ?? true,
      desired: intent.desired,
      state: "refused",
      url: null,
      refusal: { code, detail },
    };
    return state;
  };
  // Mutations and reads share one queue so an older status cannot overwrite a newer switch.
  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const next = serial.then(run);
    serial = next.then(
      () => {},
      () => {},
    );
    return next;
  }
  async function loadIntent() {
    intent = (await options.load()) ?? { desired: "off", mapping: null };
    state = {
      ...state,
      desired: intent.desired,
      allowRemoteAdministration: intent.allowRemoteAdministration ?? true,
    };
  }
  async function status() {
    await loadIntent();
    const identity = JSON.parse(await options.run(["status", "--json"])) as {
      BackendState?: string;
      Self?: { DNSName?: string };
    };
    const hostname = identity.Self?.DNSName?.replace(/\.$/, "").toLowerCase();
    if (
      identity.BackendState !== "Running" ||
      !hostname ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.ts\.net$/.test(hostname)
    )
      throw Error("Tailscale is not running with a MagicDNS hostname");
    const mapping = { authority: `${hostname}:443`, target: `http://127.0.0.1:${options.port()}` };
    const config = JSON.parse(await options.run(["serve", "status", "--json"])) as ServeStatus;
    if (!config || typeof config !== "object" || Array.isArray(config))
      throw Error("Invalid Serve status");
    const web = Object.entries(config.Web ?? {}).filter(([key]) => key.endsWith(":443"));
    const occupied =
      config.TCP?.["443"] !== undefined ||
      web.length > 0 ||
      config.AllowFunnel?.[mapping.authority] === true;
    const owned =
      intent.mapping?.authority === mapping.authority && intent.mapping.target === mapping.target;
    const exact =
      owned &&
      JSON.stringify(config.TCP?.["443"]) === '{"HTTPS":true}' &&
      web.length === 1 &&
      web[0]![0] === mapping.authority &&
      JSON.stringify(web[0]![1]) ===
        JSON.stringify({ Handlers: { "/": { Proxy: mapping.target } } }) &&
      !config.AllowFunnel?.[mapping.authority];
    if (occupied && !exact) {
      refused(
        "share.foreign-config",
        "HTTPS 443 has foreign or unverified Serve configuration; it was not changed.",
      );
    } else {
      state = {
        ...state,
        desired: intent.desired,
        state: exact && intent.desired === "on" ? "on" : "off",
        url: exact && intent.desired === "on" ? `https://${hostname}` : null,
        refusal: null,
      };
    }
    return { occupied, exact, mapping };
  }
  async function inspect() {
    if (!options.installed)
      return refused("share.installed-only", "Use the Share switch on the installed host.");
    try {
      await status();
    } catch (error) {
      refused("share.unavailable", String(error));
    } finally {
      checkedAt = Date.parse(now());
    }
    return state;
  }
  return {
    read: () => {
      const age = Date.parse(now()) - checkedAt;
      if (age >= 0 && age < 5_000) return Promise.resolve(state);
      if (inFlight) return inFlight;
      const next = exclusive(inspect).finally(() => {
        if (inFlight === next) inFlight = undefined;
      });
      inFlight = next;
      return next;
    },
    current: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(on: boolean) {
      return exclusive(async () => {
        if (!options.installed)
          return refused("share.installed-only", "Use the Share switch on the installed host.");
        try {
          checkedAt = Number.NEGATIVE_INFINITY;
          if (!on) {
            await loadIntent();
            intent = { ...intent, desired: "off" };
            await options.save(intent);
            state = { ...state, desired: "off", url: null };
            notify();
          }
          const before = await status();
          intent = { ...intent, desired: on ? "on" : "off" };
          if (before.occupied && !before.exact) {
            await options.save(intent);
            return refused(
              "share.foreign-config",
              "HTTPS 443 is not our verified mapping; it was not changed.",
            );
          }
          intent = { ...intent, mapping: before.mapping };
          await options.save(intent);
          if (on !== before.exact) {
            try {
              await options.run(
                on
                  ? ["serve", "--yes", "--bg", "--https=443", before.mapping.target]
                  : ["serve", "--https=443", "off"],
              );
            } finally {
              await status();
            }
          } else await status();
          if (state.state !== (on ? "on" : "off"))
            return refused("share.not-verified", "Serve did not confirm the requested mapping.");
          return state;
        } catch (error) {
          return refused("share.unavailable", String(error));
        } finally {
          checkedAt = Date.parse(now());
          notify();
        }
      });
    },
    setRemoteAdministration(allowRemoteAdministration: boolean) {
      return exclusive(async () => {
        if (!options.installed)
          return refused(
            "share.installed-only",
            "Use the installed host to change remote administration.",
          );
        try {
          await loadIntent();
          intent = { ...intent, allowRemoteAdministration };
          await options.save(intent);
          state = { ...state, allowRemoteAdministration };
          return state;
        } catch (error) {
          checkedAt = Number.NEGATIVE_INFINITY;
          return refused("share.unavailable", String(error));
        } finally {
          notify();
        }
      });
    },
    observe(result: IdentityResult, path: string, from: string) {
      if ("refusal" in result)
        state = {
          ...state,
          refused: [
            ...state.refused,
            { atUtc: now(), code: result.refusal.code, from: from.slice(0, 256) },
          ].slice(-32),
        };
      else if (result.principal.kind === "tailnet") {
        const login = result.principal.login;
        state = {
          ...state,
          callers: [
            ...state.callers.filter((caller) => caller.login !== login),
            {
              login,
              lastAtUtc: now(),
              door: path.startsWith("/mcp") ? "mcp" : path.startsWith("/pe/") ? "pe" : "web",
            },
          ].slice(-64) as MachineShare["callers"],
        };
      } else return;
      notify();
    },
  };
}
export type ShareOwner = ReturnType<typeof createShare>;

export const shareRoute = (share: ShareOwner) =>
  HttpRouter.add("PUT", "/pe/share", (request) =>
    Effect.gen(function* () {
      if (invocationContext()?.principal?.kind !== "local")
        return HttpServerResponse.jsonUnsafe(
          { error: "Sharing is an installed local switch." },
          { status: 403 },
        );
      const parsed = yield* Effect.result(request.json);
      const body = parsed._tag === "Success" ? parsed.success : null;
      if (
        !body ||
        typeof body !== "object" ||
        Object.keys(body).length !== 1 ||
        ((!("on" in body) || typeof body.on !== "boolean") &&
          (!("allowRemoteAdministration" in body) ||
            typeof body.allowRemoteAdministration !== "boolean"))
      )
        return HttpServerResponse.jsonUnsafe(
          { error: "Expected { on: boolean } or { allowRemoteAdministration: boolean }" },
          { status: 400 },
        );
      const value = yield* Effect.promise(() =>
        "on" in body
          ? share.set(body.on as boolean)
          : share.setRemoteAdministration(body.allowRemoteAdministration as boolean),
      );
      return HttpServerResponse.jsonUnsafe(value, {
        status: value.state === "refused" ? 409 : 200,
      });
    }),
  );
