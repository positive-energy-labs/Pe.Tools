import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test } from "vite-plus/test";
import { connect, type Page } from "./cdp.ts";
import {
  workEvidence,
  CONVERSATION_THREADS,
  UNSAVED_REF,
  NAMES_TURN,
} from "./conversation-work.fixture.ts";
import {
  address,
  sameAddress,
  documentRequestSchema,
  readingKey,
  bindWork,
} from "../../packages/agent-contracts/src/index.ts";

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
      expect(
        await page?.read<string[]>(
          `[...document.querySelectorAll('[role="alert"]')].filter(${visible}).map(e => e.innerText)`,
        ),
        "a completed interaction leaves no rendered crash or refusal alert",
      ).toEqual([]);
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
    expect(custody.inference, "Send coverage must never call an external model").toBe(
      "substituted-acp-adapter",
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
          data:
            ["/pe/turn-element-names", "/pe/threads"].includes(
              new URL(params.request.url).pathname,
            ) || /\/prompt$|\/place$/.test(new URL(params.request.url).pathname)
              ? params.request.postData
              : undefined,
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
    const pickThread = async (thread: string) => {
      if (await p.has("Expand pea")) await p.click("Expand pea");
      if (await p.has("Expand threads")) await p.click("Expand threads");
      // The row's label may change after an explicit Work reference. Identity does not.
      await p.clickAt(`[data-thread-sidebar] [data-key="${thread}"] .dl-row-label`);
    };
    const openWork = async (thread: string) => {
      if (await p.has("Expand pea")) await p.click("Expand pea");
      if (await p.has("Expand threads")) await p.click("Expand threads");
      await p.click("Open Ducts", `[data-thread-sidebar] [data-key="${thread}"]`);
    };
    const toolsCollapsed = async () =>
      new URL(await p.url()).pathname === "/pea" &&
      (await p.has("Expand tools")) &&
      (await p.read<boolean>(`(() => {
        const root = document.querySelector('section[data-slot="pane"][data-pane-id="tools"]');
        return Boolean(root && [...root.querySelectorAll('[data-route-tab]')].every(e => !e.getClientRects().length));
      })()`));
    const choosePlace = async (label: string | RegExp) => {
      if (await p.has("Expand tools")) await p.click("Expand tools");
      await p.click(label, '[aria-label="Places"]');
    };
    const draft = () =>
      p.read<string>(
        `[...document.querySelectorAll('textarea[aria-label="Message"],input[aria-label="Message"]')].find(${visible})?.value ?? ''`,
      );
    const composerIdentity = async () => {
      const located = await p.send("Runtime.evaluate", {
        expression: `[...document.querySelectorAll('textarea[aria-label="Message"],input[aria-label="Message"]')].find(${visible})`,
        returnByValue: false,
      });
      expect(located.exceptionDetails).toBeUndefined();
      const objectId = located.result.objectId;
      expect(objectId).toBeTruthy();
      try {
        return (await p.send("DOM.describeNode", { objectId })).node.backendNodeId as number;
      } finally {
        await p.send("Runtime.releaseObject", { objectId });
      }
    };
    let officeComposer: number;
    let browserPlaceId: string;
    const headTargets = async (thread = CONVERSATION_THREADS.office) => {
      const meta = JSON.parse(
        await readFile(
          join(seed.productHome, ".local-state", "state", "harness-threads", thread, "meta.json"),
          "utf8",
        ),
      );
      expect(meta.head.targets, "reading saved Work must not arm a native target").toEqual([]);
    };
    await step("standalone tool creates no conversation and remembers its own Place", async () => {
      const before = network.length;
      await p.open(url(seed.placeUrl));
      await p.send("Page.bringToFront");
      await p.until(
        async () => network.some((event) => event.build === head.slice(0, 12)),
        "standalone source hydration",
        90_000,
      );
      await p.until(
        async () =>
          p.read<boolean>(`(() => {
          const id = history.state.__peRouteTab?.id;
          return Boolean(id && [...document.querySelectorAll('[data-route-tab]')].some(e => e.getClientRects().length && e.getAttribute('data-route-tab') === id));
        })()`),
        "standalone browser Place identity",
      );
      browserPlaceId = await p.read<string>("history.state.__peRouteTab.id");
      expect(
        await p.count('[aria-label="Places"] button[aria-pressed][aria-label^="Ducts"]'),
        "one pasted URL enrolls exactly one Place",
      ).toBe(1);
      expect(new URL(await p.url()).searchParams.has("thread")).toBe(false);
      expect(
        network
          .slice(before)
          .filter(
            (event) =>
              event.method === "POST" &&
              event.url &&
              /\/pe\/threads$|\/scope\/|\/place$/.test(new URL(event.url).pathname),
          ),
      ).toEqual([]);
      await p.open(url(`/takeoffs?target=${encodeURIComponent(seed.address)}`));
      await p.until(
        async () =>
          p.read<boolean>(`(() => {
          const id = history.state.__peRouteTab?.id;
          return Boolean(id && [...document.querySelectorAll('[data-route-tab]')].some(e => e.getClientRects().length && e.getAttribute('data-route-tab') === id));
        })()`),
        "second browser Place",
      );
      expect(new URL(await p.url()).searchParams.has("thread")).toBe(false);
      expect(
        await p.count('[aria-label="Places"] button[aria-pressed][aria-label^="Takeoffs"]'),
        "one second tool URL enrolls exactly one Place",
      ).toBe(1);
      receipt.coverage.standalone = { thread: null, browserPlaceId, hostWrites: [] };
    });
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
    await step("Work from another row preserves the selected conversation", async () => {
      await openWork(CONVERSATION_THREADS.office);
      await p.until(
        async () => new URL(await p.url()).pathname === "/ducts",
        "Work tool opens in current conversation",
      );
      expect(new URL(await p.url()).searchParams.get("thread")).toBe(CONVERSATION_THREADS.empty);
      expect(new URL(await p.url()).searchParams.get("system")).toBe(seed.retainedPage);
      expect(await p.read("history.state.__peRouteTab.id")).toBe(browserPlaceId);
      await headTargets(CONVERSATION_THREADS.empty);
      await pickThread(CONVERSATION_THREADS.empty);
      await p.until(toolsCollapsed, "conversation entry collapses tools without replacing Places");
    });
    await step("thread press stays chat with tools collapsed", async () => {
      // List rows have a separate Open Ducts button; pressing their label is a thread pick.
      await pickThread(CONVERSATION_THREADS.office);
      await p.until(
        async () =>
          new URL(await p.url()).searchParams.get("thread") === CONVERSATION_THREADS.office,
        "Office thread selected",
      );
      await p.until(toolsCollapsed, "tools remain collapsed after thread selection");
      expect(new URL(await p.url()).pathname).toBe("/pea");
    });
    await step("settled prose batches its bare ids through the real names read", async () => {
      const names = () =>
        network.filter(
          (event) => event.url && new URL(event.url).pathname === "/pe/turn-element-names",
        );
      await p.until(
        async () =>
          names().some(
            (event) => event.event === "Network.responseReceived" && event.status === 200,
          ),
        "public names read returns successfully",
      );
      const requests = names().filter((event) => event.event === "Network.requestWillBeSent");
      expect(requests).toHaveLength(1);
      expect(JSON.parse(requests[0]!.data!)).toEqual({
        kind: "turn-element-names",
        thread: CONVERSATION_THREADS.office,
        turnId: NAMES_TURN,
        ids: [1001, 1002],
      });
      await p.waitText("Review 1001 and 1002.");
      expect(await p.count("[data-chat-transcript] [data-revit-ids]")).toBe(0);
      receipt.coverage.turnNames = {
        ids: [1001, 1002],
        requests: requests.length,
        status: 200,
        unresolvedStayPlain: true,
        nativeTargets: [],
      };
    });
    const message = "Unsent office draft retained across tools and history";
    await step("Work opens closed saved Ducts and draft survives Places collapse", async () => {
      await p.clickAt('textarea[aria-label="Message"],input[aria-label="Message"]');
      await p.type(message);
      expect(await draft(), "trusted typing authored the draft before opening Work").toBe(message);
      officeComposer = await composerIdentity();
      receipt.coverage.draftBeforeWork = {
        url: await p.url(),
        value: await draft(),
        backendNodeId: officeComposer,
      };
      await openWork(CONVERSATION_THREADS.office);
      await p.until(
        async () => new URL(await p.url()).pathname === "/ducts",
        "saved Work URL opens",
      );
      const historyState = await p.read<{ __peRouteTab?: { id?: string } }>("history.state");
      receipt.coverage.workResume = {
        expectedUrl: seed.placeUrl,
        expectedTabId: browserPlaceId,
        actualUrl: await p.url(),
        historyState,
      };
      expect(
        new URL(await p.url()).searchParams.get("system"),
        "Work press restores the saved Place's nondefault Page",
      ).toBe(seed.retainedPage);
      expect(historyState.__peRouteTab?.id, "Work press preserves the exact saved Place id").toBe(
        browserPlaceId,
      );
      expect(
        sameAddress(
          address(new URL(await p.url()).searchParams.get("target")!),
          address(seed.address),
        ),
        "a legacy open-ref Place rebases to the Work's stable Address",
      ).toBe(true);
      await p.until(
        async () => /closed|reconnect|not open|choose.*document/i.test(await p.text()),
        "closed-document reconnect state",
      );
      await headTargets();
      // Opening Work can fit Threads by folding the chat to its rail; reveal it before reading it.
      if (await p.has("Expand chat")) await p.click("Expand chat");
      expect(await draft()).toBe(message);
      expect(await composerIdentity()).toBe(officeComposer);
      await choosePlace("Takeoffs");
      await p.until(
        async () => new URL(await p.url()).pathname === "/takeoffs",
        "second persisted Place",
      );
      expect(await draft()).toBe(message);
      await choosePlace(/^Ducts/);
      await p.until(
        async () => new URL(await p.url()).pathname === "/ducts",
        "Ducts Place restored",
      );
      await pickThread(CONVERSATION_THREADS.office);
      await p.until(toolsCollapsed, "tools collapsed explicitly");
      expect(await draft()).toBe(message);
      await choosePlace(/^Ducts/);
      await p.until(
        async () => new URL(await p.url()).pathname === "/ducts",
        "tools reopened from Place",
      );
      expect(await draft()).toBe(message);
      expect(await composerIdentity()).toBe(officeComposer);
    });
    await step("expanded dock keeps Pea readable at narrow and wide viewports", async () => {
      const layouts = [];
      for (const width of [1200, 1920, 1400]) {
        await p.send("Emulation.setDeviceMetricsOverride", {
          width,
          height: 900,
          deviceScaleFactor: 1,
          mobile: false,
        });
        const axis = "horizontal";
        await p.until(
          async () =>
            p.read<boolean>(
              `document.querySelector('[data-pane-id="tools"]')?.closest('[data-slot="pane-split"]')?.getAttribute('data-axis') === ${JSON.stringify(axis)}`,
            ),
          `${width}px dock reaches its ${axis} layout`,
        );
        const layout = await p.read<{
          viewport: number;
          document: number;
          composer: number;
          pea: number;
          tools: number;
          density: string | null;
        }>(`(() => {
          const composer = [...document.querySelectorAll('[data-chat-composer]')].find(${visible});
          return { viewport: innerWidth, document: document.documentElement.scrollWidth,
            composer: composer?.getBoundingClientRect().width ?? 0,
            pea: [...document.querySelectorAll('[data-chat="surface"]')].find(e => e.getClientRects().length)?.getBoundingClientRect().width ?? 0,
            tools: document.querySelector('[data-pane-id="tools"]')?.getBoundingClientRect().width ?? 0,
            density: document.documentElement.getAttribute('data-density') };
        })()`);
        expect(layout.viewport).toBe(width);
        expect(Number.isFinite(layout.composer)).toBe(true);
        expect(layout.pea, "Pea keeps its accepted pane floor").toBeGreaterThanOrEqual(280);
        expect(layout.tools, "tools keep their accepted pane floor").toBeGreaterThanOrEqual(420);
        expect(layout.document, "the dock introduces no horizontal overflow").toBeLessThanOrEqual(
          width + 1,
        );
        expect(await composerIdentity()).toBe(officeComposer);
        layouts.push(layout);
        await p.dump(dir, `viewport-${width}`);
      }
      receipt.coverage.layout = layouts;
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
      expect(await composerIdentity()).toBe(officeComposer);
    });
    await step(
      "the tool directory changes the tool without selecting another conversation",
      async () => {
        const before = await p.url();
        const requests = network.length;
        await p.click("Home / tool directory");
        await p.waitText("Find a tool");
        await p.click("Show All exposure");
        await p.clickAt('input[aria-label="Search tools and saved Works"]');
        await p.type("Ducts");
        await p.until(
          () =>
            p.read<boolean>(`(() => {
            const rows = [...document.querySelectorAll('[data-list-view][aria-label="tools and saved Works"] [role="treeitem"][data-key]')].filter(${visible});
            return rows.length > 0 && rows.every(row => row.getAttribute('data-key') === '/ducts' || row.getAttribute('data-key').startsWith('work:ducts/'));
          })()`),
          "the directory filter has rendered only Ducts and its saved Works",
        );
        await p.clickAt(
          '[data-list-view][aria-label="tools and saved Works"] [data-key="/ducts"] .dl-row-label',
        );
        await p.until(
          async () => new URL(await p.url()).pathname === "/ducts",
          "directory opens Ducts",
        );
        expect(new URL(await p.url()).searchParams.get("thread")).toBe(CONVERSATION_THREADS.office);
        expect(
          new URL(await p.url()).searchParams.get("target"),
          "the directory never inherits another tool's subject",
        ).toBeNull();
        if (await p.has("Expand chat")) await p.click("Expand chat");
        expect(await draft()).toBe(message);
        expect(await composerIdentity()).toBe(officeComposer);
        expect(
          network
            .slice(requests)
            .filter(
              (event) =>
                event.method === "POST" &&
                event.url &&
                /\/pe\/threads$|\/scope\/|\/place$/.test(new URL(event.url).pathname),
            ),
          "ordinary tool navigation creates no chat, document admission or Work association",
        ).toEqual([]);
        // These two named moves return through the directory to the original retained Place.
        for (let move = 0; move < 2; move++) {
          const history = await p.send("Page.getNavigationHistory");
          const back = history.entries[history.currentIndex - 1];
          if (!back || new URL(back.url).origin !== base.origin)
            throw Error("PRECONDITION: missing directory history entry");
          await p.send("Page.navigateToHistoryEntry", { entryId: back.id });
          await p.until(
            async () => (await p.url()) === back.url,
            "one directory history move settled",
          );
        }
        await p.until(
          async () => (await p.url()) === before,
          "Back restores the exact prior tool Place",
        );
        expect(await draft()).toBe(message);
        expect(await composerIdentity()).toBe(officeComposer);
        expect(await workEvidence(seed.productHome)).toEqual(initial);
        receipt.coverage.directory = {
          thread: CONVERSATION_THREADS.office,
          nativeTargets: [],
          hostWrites: [],
        };
      },
    );
    await step("another conversation starts with collapsed tools", async () => {
      await pickThread(CONVERSATION_THREADS.empty);
      await p.until(
        async () =>
          new URL(await p.url()).searchParams.get("thread") === CONVERSATION_THREADS.empty &&
          new URL(await p.url()).pathname === "/pea",
        "other conversation selected",
      );
      expect(await p.count('[aria-label="Places"] button[aria-pressed]')).toBeGreaterThan(0);
      expect(await p.count('[aria-label="Places"] button[aria-pressed="true"]')).toBe(0);
    });
    await step("pasted closed Work URL reads retained Work without native target", async () => {
      const opened = Date.now();
      await p.open(url(seed.workUrl));
      expect(new URL(await p.url()).searchParams.has("thread")).toBe(false);
      const snapshot = await p.until(async () => {
        const streams = new Set(
          network
            .filter(
              (event) =>
                event.at >= opened &&
                event.event === "Network.requestWillBeSent" &&
                event.url?.includes("/pe/resources"),
            )
            .map((event) => event.id),
        );
        for (const event of network) {
          if (
            event.at < opened ||
            !streams.has(event.id) ||
            event.event !== "Network.eventSourceMessageReceived" ||
            !event.data
          )
            continue;
          const frame = JSON.parse(event.data);
          if (
            frame.kind === "snapshot" &&
            frame.value?.revision === 2 &&
            frame.value.doc?.flows?.["1001"]?.staged?.value?.source === "human effort"
          )
            return frame;
        }
        return null;
      }, "pasted route acquires its actual retained Work through SSE");
      await headTargets();
      expect(new URL(await p.url()).searchParams.get("system")).toBeNull();
      expect(
        await p.read<string[]>(
          `[...document.querySelectorAll('[data-pane-id="tools"] button[data-tone="commit"], [data-pane-id="tools"] button[data-kind="commit"]')].filter(${visible}).filter(e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.hasAttribute('data-disabled')).map(e => e.getAttribute('aria-label') || e.textContent)`,
        ),
      ).toEqual([]);
      expect(await workEvidence(seed.productHome)).toEqual(initial);
      receipt.coverage.closedDeepLink = {
        key: snapshot.key,
        revision: snapshot.value.revision,
        nativeTargets: [],
        enabledCommits: [],
      };
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
      const online = Date.now();
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
      await p.until(async () => {
        const acquired = new Set(
          network.filter((event) => event.at >= online && event.stream).map((event) => event.id),
        );
        return network.some((event) => {
          if (
            !acquired.has(event.id) ||
            event.event !== "Network.eventSourceMessageReceived" ||
            !event.data
          )
            return false;
          const frame = JSON.parse(event.data);
          return (
            frame.kind === "snapshot" &&
            frame.value?.threads?.some(
              (thread: {
                threadId: string;
                documents: { name: string }[];
                works: { id: string; unfinished: number }[];
              }) =>
                thread.threadId === CONVERSATION_THREADS.office &&
                thread.documents.some((doc) => doc.name === "Office model") &&
                thread.works.some((work) => work.id === seed.workId && work.unfinished === 3),
            )
          );
        });
      }, "reconnected stream acquires the real Office Work summary");
      if (await p.has("Expand pea")) await p.click("Expand pea");
      if (await p.has("Expand threads")) await p.click("Expand threads");
      await p.waitText("Office model");
      await p.waitText("3 unfinished");
      expect(await p.count('[role="dialog"]')).toBe(0);
      if (await p.has("Expand chat")) await p.click("Expand chat");
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
      const flows = after.find((work) => work.record.targetKey === seed.workId)!.record.value.doc
        .flows;
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
    await step(
      "closed unsaved Work stays visible and bound only to its original lifetime",
      async () => {
        await pickThread(CONVERSATION_THREADS.unsaved);
        await p.until(
          async () =>
            new URL(await p.url()).pathname === "/pea" &&
            new URL(await p.url()).searchParams.get("thread") === CONVERSATION_THREADS.unsaved,
          "unsaved-document conversation opens without its tool",
        );
        const opened = Date.now();
        await openWork(CONVERSATION_THREADS.unsaved);
        await p.until(
          async () => new URL(await p.url()).pathname === "/ducts",
          "retained unsaved Work opens",
        );
        const target = new URL(await p.url()).searchParams.get("target");
        // TanStack JSON-quotes a carry string that itself contains a JSON DocumentRequest.
        const queryValue = JSON.parse(target!);
        const request = documentRequestSchema.parse(
          typeof queryValue === "string" ? JSON.parse(queryValue) : queryValue,
        );
        expect(request).toEqual({ kind: "open", ref: UNSAVED_REF });
        const expectedKey = readingKey({
          kind: "work",
          ...bindWork("ducts", null, undefined, UNSAVED_REF),
        });
        await p.until(
          async () =>
            network.some((event) => {
              if (
                event.at < opened ||
                event.event !== "Network.eventSourceMessageReceived" ||
                !event.data
              )
                return false;
              const frame = JSON.parse(event.data);
              return (
                frame.kind === "snapshot" &&
                frame.key === expectedKey &&
                frame.value?.doc?.flows?.["1002"]?.staged?.value?.cfm === 200 &&
                frame.value.doc.flows["1002"].proposal?.value?.cfm === 220
              );
            }),
          "unsaved Work reading uses the exact original lifetime and retains staged/proposed values",
        );
        await p.waitText("Work is kept, read-only, while its document is closed.");
        await p.waitText("3 unfinished");
        await headTargets(CONVERSATION_THREADS.unsaved);
        expect(await workEvidence(seed.productHome)).toEqual(initial);
        receipt.coverage.unsaved = {
          target: request,
          readingKey: expectedKey,
          workId: seed.unsavedWorkId,
          nativeTargets: [],
        };
      },
    );
    await step("first Send creates one chat without replacing the current tool", async () => {
      await p.open(url(seed.workUrl));
      await p.until(async () => p.has(/^send$/i), "standalone composer send control");
      expect(new URL(await p.url()).searchParams.has("thread")).toBe(false);
      const before = network.length;
      await p.clickAt('textarea[aria-label="Message"],input[aria-label="Message"]');
      await p.type("pid");
      await p.click(/^send$/i);
      const thread = await p.until(
        async () => new URL(await p.url()).searchParams.get("thread"),
        "first Send publishes a real conversation",
      );
      expect(new URL(await p.url()).pathname).toBe("/ducts");
      await p.waitText("PID=");
      expect(
        network
          .slice(before)
          .filter(
            (event) =>
              event.event === "Network.requestWillBeSent" &&
              event.method === "POST" &&
              event.url &&
              new URL(event.url).pathname === "/pe/threads",
          ),
      ).toHaveLength(1);
      await headTargets(thread);
      expect(await workEvidence(seed.productHome)).toEqual(initial);
      receipt.coverage.firstSend = {
        thread,
        created: 1,
        retainedPath: "/ducts",
        inference: "substituted-acp-adapter",
      };
      await pickThread(thread);
      await p.until(toolsCollapsed, "explicit collapse keeps the newly issued conversation");
      await p.clickAt('textarea[aria-label="Message"],input[aria-label="Message"]');
      await p.type("route-cutover-open");
      await p.click(/^send$/i);
      await p.until(
        async () => new URL(await p.url()).pathname === "/families",
        "explicit Pea context opens its tool",
      );
      expect(new URL(await p.url()).searchParams.get("thread")).toBe(thread);
      await p.waitText("route-cutover-rendered");
      await headTargets(thread);
      expect(await workEvidence(seed.productHome)).toEqual(initial);
      receipt.coverage.explicitPeaOpen = {
        thread,
        route: "families",
        acquisition: "command-id-fenced lease and rendered ack",
        inference: "substituted-acp-adapter",
        nativeTargets: [],
      };
    });
    expect(
      network.filter(
        (event) =>
          event.method === "POST" &&
          event.url &&
          /\/actions$|\/call$/.test(new URL(event.url).pathname),
      ),
      "journey must not invoke native operations",
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
      await page.close();
    }
    await save();
  }
});
