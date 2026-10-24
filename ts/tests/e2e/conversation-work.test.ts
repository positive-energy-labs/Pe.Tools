import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { connect, type Page } from "./cdp.ts";
import { workEvidence, CONVERSATION_THREADS } from "./conversation-work.fixture.ts";

const visible = `(e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden'`;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: resolve(import.meta.dirname, "../../.."),
    encoding: "utf8",
    windowsHide: true,
  }).trim();
type Network = {
  event: string;
  id?: string;
  url?: string;
  method?: string;
  status?: number;
  stream?: boolean;
  data?: string;
  build?: string;
  at: number;
};

test("real conversation Work cutover retains authored cells, draft, Places and one quiet shared Reading", async () => {
  const dir = process.env.CONVERSATION_WORK_ARTIFACT_DIR;
  if (!dir) throw Error("PRECONDITION: CONVERSATION_WORK_ARTIFACT_DIR is required");
  await mkdir(dir, { recursive: true });
  const source = resolve(import.meta.dirname, "../../..");
  const head = git("rev-parse", "HEAD");
  const network: Network[] = [];
  const steps: { name: string; at: string; result: string }[] = [];
  const receipt = {
    lane: "browser-source-no-revit",
    source,
    head,
    productDirty: git(
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      "ts/apps",
      "ts/packages",
    ),
    web: process.env.WEB_BASE_URL,
    port: process.env.CDP_PORT,
    target: process.env.CDP_TARGET,
    startedAt: new Date().toISOString(),
    result: "UNPROVEN",
    steps,
    coverage: {} as Record<string, unknown>,
    errors: [] as string[],
  };
  let page: Page | undefined;
  const save = async () => {
    await writeFile(join(dir, "journey-result.json"), JSON.stringify(receipt, null, 2));
    await writeFile(join(dir, "network.json"), JSON.stringify(network, null, 2));
  };
  const step = async (name: string, run: () => Promise<void>) => {
    const entry = { name, at: new Date().toISOString(), result: "running" };
    steps.push(entry);
    try {
      await run();
      entry.result = "passed";
      await page?.dump(dir, `${steps.length}-${name.replace(/[^a-z0-9]+/gi, "-")}`);
    } catch (error) {
      entry.result = String(error);
      throw error;
    } finally {
      await save();
    }
  };
  try {
    if (
      !process.env.WEB_BASE_URL ||
      !process.env.CDP_PORT ||
      !process.env.CDP_TARGET ||
      !process.env.PE_TOOLS_PRODUCT_HOME
    )
      throw Error(
        "PRECONDITION: WEB_BASE_URL, CDP_PORT, CDP_TARGET and PE_TOOLS_PRODUCT_HOME must name the isolated run",
      );
    if (Number(process.env.CDP_PORT) === 9292)
      throw Error("PRECONDITION: kit Chrome 9292 is protected");
    const base = new URL(process.env.WEB_BASE_URL);
    if (base.searchParams.has("demo") || base.port === "54026")
      throw Error(
        "PRECONDITION: real isolated source runtime required; parent 54026 and demo are protected",
      );
    if (receipt.productDirty) throw Error("PRECONDITION: product source has uncommitted changes");
    const custody = JSON.parse(await readFile(join(dir, "custody.json"), "utf8"));
    if (custody.mode !== "owned-source-no-revit-no-tray" || !custody.hostSource)
      throw Error(
        "PRECONDITION: fresh owned host source provenance is required, not only a client build header",
      );
    expect(custody.hostSource).toEqual({
      commit: head,
      productDirty: "",
      entry: "ts/apps/host/src/dev.ts",
      loader: "jiti/register",
    });
    const hostService = JSON.parse(await readFile(custody.service, "utf8"));
    expect(hostService.pid).toBe(custody.hostPid);
    expect(resolve(hostService.sourceRoot).toLowerCase()).toBe(source.toLowerCase());
    receipt.coverage.hostSource = {
      commit: custody.hostSource.commit,
      entry: custody.hostSource.entry,
      loader: custody.hostSource.loader,
      pid: hostService.pid,
      sourceRoot: hostService.sourceRoot,
      processStartUtc: hostService.processStartUtc,
      instanceId: hostService.instanceId,
    };
    const seed = JSON.parse(await readFile(join(dir, "seed.json"), "utf8"));
    expect(resolve(seed.productHome)).toBe(resolve(process.env.PE_TOOLS_PRODUCT_HOME));
    const initial = await workEvidence(seed.productHome);
    expect(initial).toEqual(seed.evidence);
    expect(seed.unfinished).toBe(3);
    page = await connect();
    const p = page;
    p.onEvent(({ method, params }) => {
      if (method === "Network.requestWillBeSent") {
        const builds = Object.entries(params.request.headers ?? {})
          .filter(([key]) => key.toLowerCase() === "x-pe-web-build")
          .map(([, value]) => String(value));
        network.push({
          event: method,
          id: params.requestId,
          url: params.request.url,
          method: params.request.method,
          build: builds[0],
          at: Date.now(),
        });
      } else if (method === "Network.responseReceived")
        network.push({
          event: method,
          id: params.requestId,
          url: params.response.url,
          status: params.response.status,
          stream: params.response.mimeType === "text/event-stream",
          at: Date.now(),
        });
      else if (method === "Network.eventSourceMessageReceived")
        network.push({ event: method, id: params.requestId, data: params.data, at: Date.now() });
      else if (method === "Network.loadingFailed")
        network.push({
          event: method,
          id: params.requestId,
          data: params.errorText,
          at: Date.now(),
        });
    });
    const url = (path: string) => new URL(path, base).href;
    const pickThread = async (title: string) => {
      if (await p.has("Expand threads")) await p.click("Expand threads");
      const point = await p.until(
        () =>
          p.read<{ x: number; y: number } | null>(`(() => {
        const label = [...document.querySelectorAll('[data-thread-sidebar] *')].find(e => !e.children.length && e.textContent.trim() === ${JSON.stringify(title)} && e.getClientRects().length);
        if(!label)return null; const r=label.getBoundingClientRect(); return {x:r.left+Math.min(r.width/2,60),y:r.top+r.height/2};
      })()`),
        `${title} thread label`,
      );
      for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
        await p.send("Input.dispatchMouseEvent", { type, ...point, button: "left", clickCount: 1 });
    };
    const toolsCollapsed = async () =>
      new URL(await p.url()).pathname === "/pea" &&
      /tools collapsed/i.test(await p.textOf('[data-pane-id="tools"]')) &&
      (await p.read<boolean>(
        `[...document.querySelectorAll('[data-pane-id="tools"] [data-route-tab]')].every(e => !e.getClientRects().length)`,
      ));
    const draft = () =>
      p.read<string>(
        `[...document.querySelectorAll('textarea[aria-label="Message"],input[aria-label="Message"]')].find(${visible})?.value ?? ''`,
      );
    const headTargets = async () => {
      const meta = JSON.parse(
        await readFile(
          join(
            seed.productHome,
            ".local-state",
            "state",
            "harness-threads",
            CONVERSATION_THREADS.office,
            "meta.json",
          ),
          "utf8",
        ),
      );
      expect(meta.head.targets, "reading saved Work must not arm a native target").toEqual([]);
    };
    await step("real startup and canonical sidebar", async () => {
      const started = Date.now();
      await p.open(url(`/pea?thread=${CONVERSATION_THREADS.empty}`));
      await p.send("Page.bringToFront");
      expect(await p.read("document.visibilityState")).toBe("visible");
      expect(new URL(await p.url()).searchParams.has("demo")).toBe(false);
      // A cold source Vite graph loads hundreds of modules before the device gate can read.
      // Keep that startup budget separate from the unchanged interaction/read deadlines below.
      await p.until(
        async () => network.some((event) => event.build === head.slice(0, 12)),
        "cold source client hydration and first host request",
        90_000,
      );
      receipt.coverage.startup = {
        milliseconds: Date.now() - started,
        moduleRequests: network.filter((event) => event.event === "Network.requestWillBeSent")
          .length,
      };
      await p.waitText("Office model");
      await p.waitText("3 unfinished");
      await p.waitText("Conversation without Work");
      await p.until(
        async () => network.some((event) => event.build === head.slice(0, 12)),
        "source-pinned real host request",
      );
      const builds = [...new Set(network.flatMap((event) => (event.build ? [event.build] : [])))];
      expect(builds).toEqual([head.slice(0, 12)]);
      await p.until(
        async () =>
          network.some(
            (event) =>
              event.data?.includes("Office model") && event.data.includes('"unfinished":3'),
          ),
        "canonical Work snapshot arriving through SSE",
      );
      receipt.coverage.source = { builds, browser: await p.send("Browser.getVersion") };
    });
    await step("thread press stays chat with tools collapsed", async () => {
      // List rows have a separate Open Ducts button; pressing their label is a thread pick.
      await pickThread("Office model");
      await p.until(
        async () =>
          new URL(await p.url()).searchParams.get("thread") === CONVERSATION_THREADS.office,
        "Office thread selected",
      );
      await p.until(toolsCollapsed, "tools remain collapsed after thread selection");
      expect(new URL(await p.url()).pathname).toBe("/pea");
    });
    const message = "Unsent office draft retained across tools and history";
    await step("Work opens closed saved Ducts and draft survives Places collapse", async () => {
      await p.clickAt('textarea[aria-label="Message"],input[aria-label="Message"]');
      await p.type(message);
      await p.click("Open Ducts");
      await p.until(
        async () => new URL(await p.url()).pathname === "/ducts",
        "saved Work URL opens",
      );
      const historyState = await p.read<{ __peRouteTab?: { id?: string } }>("history.state");
      receipt.coverage.workResume = {
        expectedUrl: seed.placeUrl,
        expectedTabId: seed.placeId,
        actualUrl: await p.url(),
        historyState,
      };
      expect(
        new URL(await p.url()).searchParams.get("system"),
        "Work press restores the saved Place's nondefault Page",
      ).toBe(seed.retainedPage);
      expect(historyState.__peRouteTab?.id, "Work press preserves the exact saved Place id").toBe(
        seed.placeId,
      );
      await p.until(
        async () => /closed|reconnect|not open|choose.*document/i.test(await p.text()),
        "closed-document reconnect state",
      );
      await headTargets();
      expect(await draft()).toBe(message);
      await p.click("Takeoffs", '[aria-label="Thread Places"]');
      await p.until(
        async () => new URL(await p.url()).pathname === "/takeoffs",
        "second persisted Place",
      );
      expect(await draft()).toBe(message);
      await p.click(/^Ducts/, '[aria-label="Thread Places"]');
      await p.until(
        async () => new URL(await p.url()).pathname === "/ducts",
        "Ducts Place restored",
      );
      await pickThread("Office model");
      await p.until(toolsCollapsed, "tools collapsed explicitly");
      expect(await draft()).toBe(message);
      await p.click(/^Ducts/, '[aria-label="Thread Places"]');
      await p.until(
        async () => new URL(await p.url()).pathname === "/ducts",
        "tools reopened from Place",
      );
      expect(await draft()).toBe(message);
    });
    await step("Home and Back preserve the composer", async () => {
      await p.click("Home / tool directory");
      await p.until(async () => new URL(await p.url()).pathname !== "/ducts", "Home navigation");
      const history = await p.send("Page.getNavigationHistory");
      const back = history.entries[history.currentIndex - 1];
      if (!back || new URL(back.url).origin !== base.origin)
        throw Error("PRECONDITION: no journey-owned browser history entry");
      await p.send("Page.navigateToHistoryEntry", { entryId: back.id });
      await p.until(async () => new URL(await p.url()).pathname === "/ducts", "Back restores Work");
      expect(await draft()).toBe(message);
    });
    await step("another conversation starts with collapsed tools", async () => {
      await pickThread("Conversation without Work");
      await p.until(
        async () =>
          new URL(await p.url()).searchParams.get("thread") === CONVERSATION_THREADS.empty &&
          new URL(await p.url()).pathname === "/pea",
        "other conversation selected",
      );
      expect(
        await p.count(
          '[aria-label="Thread Places"] [aria-checked="true"],[aria-label="Thread Places"] [aria-selected="true"]',
        ),
      ).toBe(0);
    });
    await step("pasted closed Work URL reads retained Work without native target", async () => {
      await p.open(url(`${seed.workUrl}&thread=${CONVERSATION_THREADS.office}`));
      await p.until(
        async () => /closed|reconnect|not open|choose.*document/i.test(await p.text()),
        "closed Work reconnect state after paste",
      );
      await headTargets();
      expect(await workEvidence(seed.productHome)).toEqual(initial);
    });
    await step("offline online recovers shared Work Reading", async () => {
      const streams = network.filter((event) => event.stream).length;
      await p.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      });
      await wait(1500);
      await p.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await p.until(
        async () => network.filter((event) => event.stream).length > streams,
        "shared Reading SSE reconnects",
      );
      await p.waitText("Office model");
      await p.waitText("3 unfinished");
      await headTargets();
    });
    await step("36 second quiet continuity and immutable Work readback", async () => {
      await wait(2000);
      const baseline = network.filter((event) => event.stream).length;
      const start = Date.now();
      for (let interval = 0; interval < 36; interval++) {
        await wait(1000);
        expect(
          network.filter((event) => event.stream).length,
          "quiet route must not reacquire SSE",
        ).toBe(baseline);
      }
      const publications = network.filter(
        (event) =>
          event.at >= start &&
          event.event === "Network.requestWillBeSent" &&
          event.method === "PUT" &&
          event.url?.includes("/pe/route-view/"),
      );
      expect(
        publications.length,
        "five-second lease renewal may run; publication storm may not",
      ).toBeLessThanOrEqual(8);
      const after = await workEvidence(seed.productHome);
      expect(after).toEqual(initial);
      const flows = after[0]!.record.value.doc.flows;
      expect(Object.keys(flows).sort()).toEqual(["1001", "1002", "1003"]);
      expect(flows["1002"].staged.value.cfm).toBe(200);
      expect(flows["1002"].proposal.value.cfm).toBe(220);
      await writeFile(join(dir, "work-readback.json"), JSON.stringify(after, null, 2));
      receipt.coverage.quiet = {
        milliseconds: Date.now() - start,
        sseResponses: baseline,
        leasePublications: publications.length,
      };
    });
    expect(
      network.filter(
        (event) =>
          event.method === "POST" &&
          event.url &&
          /\/prompt$|\/actions$|\/call$/.test(new URL(event.url).pathname),
      ),
      "journey must not infer or invoke native operations",
    ).toEqual([]);
    expect(network.some((event) => event.stream && event.url?.includes("/pe/resources"))).toBe(
      true,
    );
    expect(git("rev-parse", "HEAD"), "source HEAD stayed fixed throughout the drive").toBe(head);
    expect(
      git("status", "--porcelain", "--untracked-files=all", "--", "ts/apps", "ts/packages"),
      "product source stayed committed throughout the drive",
    ).toBe("");
    receipt.result = "PROVEN_BROWSER_SOURCE";
  } catch (error) {
    receipt.result = String((error as Error).message).startsWith("PRECONDITION:")
      ? "UNPROVEN_PRECONDITION"
      : "FALSIFIED_BROWSER";
    receipt.errors.push(String((error as Error).stack ?? error));
    await page?.dump(dir, "failure").catch((failure) => receipt.errors.push(String(failure)));
    throw error;
  } finally {
    if (page) {
      await page
        .send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })
        .catch(() => {});
      receipt.errors.push(...page.errors);
      page.close();
    }
    await save();
  }
});
