import { notices as storedNotices } from "@pe/host-contracts/kinds";
import { stateMachine } from "../../../tests/isolated-home/storage.ts";
import { dirname as storedParent } from "node:path";
import { mkdtemp } from "../../../tests/isolated-home/storage.ts";
import { contextHeaders } from "./callers.ts";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { createShare, shareIntentFile, tailscaleCommand, shareRoute } from "../src/share.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";
import { sha256Hex } from "@pe/host-contracts/kinds";
import { stateTree } from "@pe/host-contracts/service-identity";
import { shareKind } from "../src/share.ts";

test("fake tailscale binary: foreign rule refused; own changes re-read status; observations stay bounded", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-share-fake-"));
  const config = join(dir, "serve.json"),
    log = join(dir, "args.jsonl"),
    script = join(dir, "tailscale.cjs");
  const authority = "box.tailabc.ts.net:443";
  const foreign = {
    TCP: { "443": { HTTPS: true } },
    Web: { [authority]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9999" } } } },
  };
  const unrelated = {
    TCP: { "8443": { HTTPS: true } },
    Web: { "box.tailabc.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:7777" } } } },
  };
  await writeFile(config, JSON.stringify(foreign));
  await writeFile(
    script,
    `const fs = require('node:fs');
const [config, log, ...args] = process.argv.slice(2);
fs.appendFileSync(log, JSON.stringify(args)+'\\n');
let state = JSON.parse(fs.readFileSync(config));
if(args[0]==='status') console.log(JSON.stringify({ BackendState:'Running', Self:{DNSName:'box.tailabc.ts.net.'} }));
else if(args[1]==='status') console.log(JSON.stringify(state));
else if(args.includes('--https=443')) {
  if(args.at(-1)==='off') { delete state.TCP['443']; delete state.Web['box.tailabc.ts.net:443']; }
  else { state.TCP ??= {}; state.Web ??= {}; state.TCP['443']={HTTPS:true}; state.Web['box.tailabc.ts.net:443']={Handlers:{'/':{Proxy:args.at(-1)}}}; }
  fs.writeFileSync(config, JSON.stringify(state));
} else process.exit(2);`,
  );
  let time = "2026-10-09T00:00:00.000Z";
  const options = {
    installed: true,
    port: () => 5180,
    now: () => time,
    run: tailscaleCommand(process.execPath, [script, config, log]),
    ...shareIntentFile(stateTree(dir)),
  };
  const share = createShare(options);
  try {
    expect(await share.set(true)).toMatchObject({
      desired: "on",
      state: "refused",
      refusal: { code: "share.foreign-config" },
    });
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual(foreign);
    await writeFile(config, JSON.stringify(unrelated));
    expect(await share.set(true)).toMatchObject({
      desired: "on",
      state: "on",
      url: "https://box.tailabc.ts.net",
    });
    const calls = (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    const mutation = calls.findIndex((args) => args.includes("--bg"));
    expect(calls.slice(mutation + 1)).toEqual([
      ["status", "--json"],
      ["serve", "status", "--json"],
    ]);
    expect(await createShare(options).read()).toMatchObject({ desired: "on", state: "on" });
    await writeFile(config, JSON.stringify(foreign));
    expect(await share.set(false)).toHaveProperty("refusal.code", "share.foreign-config");
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual(foreign);
    await writeFile(config, JSON.stringify({ AllowFunnel: { [authority]: true } }));
    expect(await share.set(true)).toHaveProperty("refusal.code", "share.foreign-config");
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual({
      AllowFunnel: { [authority]: true },
    });
    await writeFile(config, JSON.stringify(unrelated));
    expect(await share.set(true)).toHaveProperty("state", "on");
    share.observe(
      {
        principal: { kind: "tailnet", login: "one", authority },
        headers: {},
        caller: { kind: "anonymous" },
      },
      "/mcp",
      authority,
    );
    time = "2026-10-09T01:00:00.000Z";
    share.observe(
      {
        principal: { kind: "tailnet", login: "one", authority },
        headers: {},
        caller: { kind: "anonymous" },
      },
      "/pe/resources",
      authority,
    );
    for (let i = 0; i < 40; i++)
      share.observe(
        { refusal: { code: "identity.missing-user", detail: "no user" } },
        "/mcp",
        authority,
      );
    expect(share.current().callers).toEqual([{ login: "one", lastAtUtc: time, door: "pe" }]);
    expect(share.current().refused).toHaveLength(32);
    expect(await share.set(false)).toMatchObject({ desired: "off", state: "off", url: null });
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual(unrelated);
    expect(await readFile(log, "utf8")).not.toContain("reset");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PUT share is local, human-only and validates the switch before invoking the owner", async () => {
  let commands = 0;
  const share = createShare({
    installed: false,
    port: () => 5180,
    load: async () => null,
    save: async () => {},
    run: async () => {
      commands++;
      return "{}";
    },
  });
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      shareRoute(share),
      requestIdentityLayer({
        port: () => 5180,
        frontendOrigin: Effect.succeed(undefined),
        share: {
          observe: () => {},
          read: async () => ({
            allowRemoteAdministration: true,
            desired: "on",
            state: "on",
            url: "https://box.tailabc.ts.net",
            refusal: null,
            callers: [],
            refused: [],
          }),
        },
      }),
    ),
    { disableLogger: true },
  );
  const human = {
    host: "127.0.0.1:5180",
    ...contextHeaders(),
  };
  const put = (body: unknown, headers: Record<string, string> = human) =>
    app.handler(
      new Request("http://127.0.0.1:5180/pe/share", {
        method: "PUT",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );
  try {
    expect(
      (await put({ on: true }, { host: "box.tailabc.ts.net", "tailscale-user-login": "one" }))
        .status,
    ).toBe(403);
    // ADR 0017 D2: anonymous loopback is read-only.
    expect((await put({ on: true }, { host: "127.0.0.1:5180" })).status).toBe(403);
    for (const body of [
      null,
      {},
      { on: "true" },
      { on: true, extra: true },
      { allowRemoteAdministration: "true" },
      { on: true, allowRemoteAdministration: true },
    ])
      expect((await put(body)).status).toBe(400);
    const response = await put({ on: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty("error.code", "share.installed-only");
    expect(commands).toBe(0);
    expect(
      (
        await put(
          { allowRemoteAdministration: false },
          { host: "box.tailabc.ts.net", "tailscale-user-login": "one" },
        )
      ).status,
    ).toBe(403);
  } finally {
    await app.dispose();
  }
});

test("Off persists cancellation even when Tailscale status is unavailable", async () => {
  let intent = {
    desired: "on" as "on" | "off",
    mapping: { authority: "box.tailabc.ts.net:443", target: "http://127.0.0.1:5180" },
  };
  let commands = 0;
  const share = createShare({
    installed: true,
    port: () => 5180,
    load: async () => intent,
    save: async (value) => {
      intent = value as typeof intent;
    },
    run: async () => {
      commands++;
      throw Error("synthetic unavailable");
    },
  });
  await share.read();
  expect(await share.set(false)).toMatchObject({ desired: "off", state: "refused", url: null });
  expect(intent.desired).toBe("off");
  expect(commands).toBe(2);
});

// ADR 0039 per-request witness: the intent used to be re-read and refused on every request
// (`share.unavailable`) until someone fixed the file by hand.
test("a share intent that does not decode is discarded on the request that meets it, not refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-share-corrupt-"));
  const machine = stateTree(dir);
  const path = shareKind.in(machine).path;
  await mkdir(machine.state, { recursive: true });
  await writeFile(path, "{ this is not JSON");
  const share = createShare({
    installed: true,
    port: () => 5180,
    ...shareIntentFile(machine),
    // A running tailnet with nothing served: the only thing wrong on this machine is the intent.
    run: async (args) =>
      args[0] === "status"
        ? JSON.stringify({ BackendState: "Running", Self: { DNSName: "box.tailabc.ts.net." } })
        : "{}",
  });
  const app = HttpRouter.toWebHandler(
    Layer.mergeAll(
      shareRoute(share),
      requestIdentityLayer({
        port: () => 5180,
        frontendOrigin: Effect.succeed(undefined),
        share: { observe: () => {}, read: () => share.read() },
      }),
    ),
    { disableLogger: true },
  );
  try {
    const response = await app.handler(
      new Request("http://127.0.0.1:5180/pe/share", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          host: "127.0.0.1:5180",
          ...contextHeaders(),
        },
        body: JSON.stringify({ on: false }),
      }),
    );
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toMatchObject({ desired: "off", refusal: null });
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({ desired: "off" });
    expect(
      storedNotices(stateMachine(storedParent(machine.notices))).filter(
        (notice) => notice.path === path,
      ),
    ).toMatchObject([{ class: "discard", place: "Sharing" }]);
  } finally {
    await app.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

// Preservation rule (K-A1): a file is replaced only after its bytes are kept. Mutant, run red:
// in `host-contracts/src/store.ts` `writeAtomic`, drop the `owed` block (the save then lands over
// bytes that have no copy). The planted copy failure is a folder where this file's blob would rest.
test("a share intent whose bytes cannot be copied aside is kept, and no save lands over it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pe-share-kept-"));
  const machine = stateTree(dir);
  const path = shareKind.in(machine).path;
  await mkdir(machine.state, { recursive: true });
  const torn = `{ torn ${crypto.randomUUID()}`;
  const blob = join(machine.blobs, "sha256", sha256Hex(torn));
  try {
    await writeFile(path, torn);
    await mkdir(blob, { recursive: true });
    const intent = shareIntentFile(machine);
    expect(await intent.load!()).toBeNull();
    expect(await readFile(path, "utf8")).toBe(torn);
    expect(
      storedNotices(stateMachine(storedParent(machine.notices))).filter((n) => n.path === path),
    ).toMatchObject([
      {
        class: "keep",
        place: "Sharing",
        reason: expect.stringContaining("could not be copied aside"),
      },
    ]);
    await expect(intent.save!({ desired: "on", mapping: null })).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(torn);
    // Once a copy can be made, the save rests the kept bytes first and then lands.
    await rm(blob, { recursive: true });
    await intent.save!({ desired: "on", mapping: null });
    expect(await readFile(blob, "utf8")).toBe(torn);
    expect(await intent.load!()).toEqual({ desired: "on", mapping: null });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
