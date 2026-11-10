import { readFile } from "node:fs/promises";
import {
  attachBrowser,
  connectBrowser,
  listBrowsers,
  openBrowser,
  type BrowserSession,
} from "./browser.ts";
import { formatProtocolHelp } from "./protocol.ts";
import { renderBrowserGuide } from "./guide.ts";
import { gestures, type GestureResult, type GestureTarget } from "./gestures.ts";

const output = (value: unknown) => process.stdout.write(JSON.stringify(value ?? null) + "\n");
export async function runBrowserCli(
  argv: readonly string[] = process.argv.slice(2),
  command: "pe-browser" | "pea browser" = "pe-browser",
): Promise<void> {
  const args = [...argv];
  function option(name: string): string | undefined {
    const index = args.indexOf(name);
    if (index < 0) return;
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    args.splice(index, 2);
    return value;
  }
  function flag(name: string): boolean {
    const index = args.indexOf(name);
    if (index < 0) return false;
    args.splice(index, 1);
    return true;
  }
  async function stdin(): Promise<string> {
    let text = "";
    for await (const chunk of process.stdin) text += String(chunk);
    return text;
  }
  async function main() {
    const home = option("--home");
    const clientId = option("--client-id");
    const targetId = option("--target");
    const url = option("--url");
    const browserLevel = flag("--browser");
    const timeoutText = option("--timeout-ms");
    const timeoutMs = timeoutText ? Number(timeoutText) : undefined;
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0))
      throw new Error("--timeout-ms must be positive");
    const verb = args.shift();
    if (verb === "guide") {
      process.stdout.write(renderBrowserGuide(command).trimEnd() + "\n");
      return;
    }
    if (!verb || verb === "--help" || (verb === "help" && !args.length)) {
      output({
        commands: [
          "guide (plain Markdown; other commands emit JSON)",
          "launch|open [--visible] [--profile DIR] [--executable PATH]",
          "attach --endpoint URL|PORT | --auto-connect --profile CHROME_USER_DATA_ROOT",
          "list|status [SESSION]",
          "targets SESSION",
          "stop|close SESSION",
          "help SESSION [Domain[.method]]",
          "SESSION Domain.method --target TARGET|--browser [--params-file FILE|--params-stdin]",
          "events SESSION --target TARGET [--method Domain.event] [--duration-ms N]",
          "SESSION click|type|press|shot --target TARGET [--name TEXT [--role R] [--within CSS] | --selector CSS] [--text T] [--key K] [--out FILE] (JSON outcome; exit 2 when blocked or mismatch)",
        ],
        options: ["--home DIR", "--client-id ID", "--timeout-ms N"],
        manual:
          "Chrome consent and sign-in require the user; attach never approves a prompt. Browser raw CDP is privileged.",
      });
      return;
    }
    if (verb === "launch" || verb === "open") {
      const visible = flag("--visible");
      const headless = flag("--headless");
      if (visible && headless) throw new Error("Choose --visible or --headless");
      const profile = option("--profile");
      const executablePath = option("--executable");
      if (flag("--unthrottled"))
        throw new Error("--unthrottled is gone: every launch keeps rendering when covered");
      const extra = args[0] === "--" ? args.slice(1) : args;
      const session = await openBrowser({
        home,
        mode: visible ? "visible" : "headless",
        profile,
        executablePath,
        timeoutMs,
        lifetime: "session",
        args: extra,
      });
      output(session.info);
      await session.disconnect();
      return;
    }
    if (verb === "attach") {
      const raw = option("--endpoint");
      const profile = option("--profile");
      const autoConnect = flag("--auto-connect") || flag("--auto");
      const endpoint = raw && /^\d+$/.test(raw) ? Number(raw) : raw;
      const session = await attachBrowser({
        home,
        endpoint,
        profile,
        autoConnect,
        timeoutMs,
        clientId,
      });
      output(session.info);
      await session.disconnect();
      return;
    }
    if (verb === "list" || (verb === "status" && !args.length)) {
      output(await listBrowsers({ home }));
      return;
    }
    let session: BrowserSession | undefined;
    try {
      const id = ["status", "targets", "stop", "close", "help", "events"].includes(verb)
        ? args.shift()
        : verb;
      if (!id) throw new Error("Session id required");
      session = await connectBrowser(id, { home, clientId });
      if (verb === "status") {
        output(session.info);
        return;
      }
      if (verb === "targets") {
        output(await session.targets());
        return;
      }
      if (verb === "stop" || verb === "close") {
        await session.close();
        output({ id, closed: true });
        return;
      }
      if (verb === "help") {
        const protocol = await session.protocol();
        const schema = flag("--schema");
        const selector = args.shift();
        output(
          schema
            ? protocol
            : { selector: selector ?? null, help: formatProtocolHelp(protocol, selector) },
        );
        return;
      }
      if (verb === "events") {
        if (!targetId) throw new Error("events requires --target TARGET");
        const method = option("--method");
        const durationMs = Number(option("--duration-ms") ?? 30000);
        if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error("Invalid duration");
        const page = await session.page({ targetId });
        try {
          const unsubscribe = page.subscribe((event) => {
            if (!method || event.method === method || event.method.startsWith(method + "."))
              output({ targetId, ...event });
          });
          if (method)
            await page.sendRaw(`${method.split(".")[0]}.enable`).catch((error) => {
              console.error("cli-runner: asynchronous operation failed", error);
            });
          await new Promise<void>((done) => {
            const timer = setTimeout(done, durationMs);
            process.once("SIGINT", () => {
              clearTimeout(timer);
              done();
            });
          });
          unsubscribe();
        } finally {
          await page.release();
        }
        return;
      }
      const method = args.shift();
      if (method === "click" || method === "type" || method === "press" || method === "shot") {
        if (!targetId) throw new Error(`${method} requires --target TARGET`);
        const name = option("--name");
        const role = option("--role");
        const within = option("--within");
        const selector = option("--selector");
        if (name && selector) throw new Error("Choose --name or --selector");
        const control: GestureTarget | undefined = name
          ? { name, ...(role ? { role } : {}), ...(within ? { within } : {}) }
          : selector;
        const text = option("--text");
        const key = option("--key");
        const out = option("--out");
        const page = await session.page({ targetId });
        try {
          const g = gestures(page);
          let result: GestureResult;
          if (method === "shot") {
            if (!out) throw new Error("shot requires --out FILE");
            result = await g.shot(out, control);
          } else if (method === "press") {
            if (!key) throw new Error("press requires --key K");
            result = await g.press(key, control ? { target: control } : {});
          } else {
            if (!control) throw new Error(`${method} requires --name TEXT or --selector CSS`);
            if (method === "click") result = await g.click(control);
            else if (text === undefined) throw new Error("type requires --text T");
            else result = await g.type(control, text);
          }
          output(result);
          // A blocked or mismatched gesture is an observation, not a CLI failure: exit 2, not 1.
          if (result.outcome !== "done") process.exitCode = 2;
        } finally {
          await page.release();
        }
        return;
      }
      if (!method?.includes(".")) throw new Error("Raw call requires Domain.method");
      const paramsFile = option("--params-file");
      const paramsStdin = flag("--params-stdin");
      if (paramsFile && paramsStdin) throw new Error("Choose params-file or params-stdin");
      const paramsText = paramsFile
        ? await readFile(paramsFile, "utf8")
        : paramsStdin
          ? await stdin()
          : "{}";
      // Windows PowerShell writes a UTF-8 BOM with Set-Content -Encoding utf8.
      const params: unknown = JSON.parse(paramsText.replace(/^\uFEFF/, ""));
      if (!params || typeof params !== "object" || Array.isArray(params))
        throw new Error("CDP params must be an object");
      if (browserLevel) {
        if (targetId) throw new Error("Choose --browser or --target");
        output(await session.sendRaw(method, params as Record<string, unknown>, { timeoutMs }));
        return;
      }
      if (!targetId && !url)
        throw new Error(
          "Raw page calls require explicit --target TARGET or --url URL; browser calls require --browser",
        );
      const page = await session.page({ targetId, url });
      try {
        output(await page.sendRaw(method, params as Record<string, unknown>, { timeoutMs }));
      } finally {
        await page.release();
      }
    } finally {
      await session?.disconnect();
    }
  }
  await main().catch((error) => {
    const e = error as import("./errors.ts").BrowserError;
    process.stderr.write(
      JSON.stringify({
        error: {
          message: e.message,
          code: e.code ?? "CliError",
          method: e.method,
          requestId: e.requestId,
          sessionId: e.sessionId,
          endpoint: e.endpoint,
          outcome: e.outcome,
          protocolCode: e.protocolCode,
          data: e.data,
        },
      }) + "\n",
    );
    process.exitCode = 1;
  });
}
