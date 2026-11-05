import { connectCdp, getTargets, type CdpClient } from "@pe/browser";

/** Callbacks must be self-contained; arguments and results cross CDP as JSON. */
export async function connectTypedPage() {
  const port = Number(process.env.CDP_PORT);
  const id = process.env.CDP_TARGET;
  if (!port || !id) throw new Error("An owned CDP_PORT and CDP_TARGET are required");
  const target = (await getTargets(port)).find(
    (target) => target.id === id && target.type === "page",
  );
  if (!target?.webSocketDebuggerUrl) throw new Error(`Owned page ${id} is unavailable`);
  const client = await connectCdp(target.webSocketDebuggerUrl);
  const send: CdpClient["send"] = client.send.bind(client);
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  let loadCount = 0;
  const unsubscribe = client.subscribe((event) => {
    if (event.method === "Page.loadEventFired") loadCount++;
    if (event.method === "Runtime.exceptionThrown") errors.push(JSON.stringify(event.params));
    // Route-address refusals log through console.error, not as uncaught exceptions.
    if (event.method === "Runtime.consoleAPICalled") {
      const { type, args } = event.params as {
        type: string;
        args: { description?: string; value?: unknown }[];
      };
      if (type === "error")
        consoleErrors.push(args.map((arg) => arg.description ?? String(arg.value)).join(" "));
    }
  });
  try {
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Network.enable");
    await client.send("Network.setCacheDisabled", { cacheDisabled: true });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 1600,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
  } catch (error) {
    unsubscribe();
    await client.close();
    throw error;
  }
  return {
    send,
    evaluate: client.evaluate.bind(client),
    errors,
    consoleErrors,
    loadCount: () => loadCount,
    async close() {
      unsubscribe();
      await client.close();
    },
  };
}

export type TypedPage = Awaited<ReturnType<typeof connectTypedPage>>;
