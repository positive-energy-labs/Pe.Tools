import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { createShare, shareIntentFile, tailscaleCommand, shareRoute } from "../src/share.ts";
import { requestIdentityLayer } from "../src/request-identity.ts";

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
    ...shareIntentFile(join(dir, "intent.json")),
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
      { principal: { kind: "tailnet", login: "one", authority }, headers: {} },
      "/mcp",
      authority,
    );
    time = "2026-10-09T01:00:00.000Z";
    share.observe(
      { principal: { kind: "tailnet", login: "one", authority }, headers: {} },
      "/pe/resources",
      authority,
    );
    for (let i = 0; i < 40; i++)
      share.observe({ refusal: { code: "missing-user", detail: "no user" } }, "/mcp", authority);
    expect(share.current().callers).toEqual([{ login: "one", lastAtUtc: time, door: "pe" }]);
    expect(share.current().refused).toHaveLength(32);
    expect(await share.set(false)).toMatchObject({ desired: "off", state: "off", url: null });
    expect(JSON.parse(await readFile(config, "utf8"))).toEqual(unrelated);
    expect(await readFile(log, "utf8")).not.toContain("reset");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PUT share is local-only and validates the switch before invoking the owner", async () => {
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
        frontendOrigin: () => undefined,
        share: {
          observe: () => {},
          read: async () => ({
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
  const put = (body: unknown, headers: Record<string, string> = { host: "127.0.0.1:5180" }) =>
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
    for (const body of [null, {}, { on: "true" }, { on: true, extra: true }])
      expect((await put(body)).status).toBe(400);
    const response = await put({ on: true });
    expect(response.status).toBe(409);
    expect(await response.json()).toHaveProperty("refusal.code", "share.installed-only");
    expect(commands).toBe(0);
  } finally {
    await app.dispose();
  }
});

test("dev never invokes tailscale; failed verification never advertises on; foreign replacement cannot be removed", async () => {
  let calls = 0;
  const empty = {
    installed: false,
    port: () => 5180,
    run: async () => {
      calls++;
      return "{}";
    },
    load: async () => null,
    save: async () => {},
  };
  expect(await createShare(empty).set(true)).toHaveProperty("refusal.code", "share.installed-only");
  expect(calls).toBe(0);
  let saved: unknown;
  const run = async (args: readonly string[]) =>
    args[0] === "status"
      ? JSON.stringify({ BackendState: "Running", Self: { DNSName: "box.tailabc.ts.net." } })
      : "{}";
  const share = createShare({
    ...empty,
    installed: true,
    run,
    load: async () => saved as never,
    save: async (value) => {
      saved = value;
    },
  });
  expect(await share.set(true)).toMatchObject({ desired: "on", state: "refused", url: null });
});
