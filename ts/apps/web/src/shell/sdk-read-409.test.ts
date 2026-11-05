import { afterEach, expect, test, vi } from "vite-plus/test";
import { composeSource } from "./readings-api";
import { createReadingGraph } from "./readings";

const transport = vi.hoisted(() => vi.fn());
vi.mock("../host/runtime", () => ({ hostFetch: transport }));
afterEach(() => transport.mockReset());

const target = { session: "attachment", openId: "open" };
const refusal = "SDK attachment changed during resolution; retry admission";
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const fixture = () => {
  transport.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error: { code: "conflict", message: refusal, details: { notDispatched: true } },
      }),
      { status: 409 },
    ),
  );
  transport.mockImplementation(
    async () => new Response(JSON.stringify({ target, slots: [], activeSlot: "", rows: [] })),
  );
  const graph = createReadingGraph(
    {
      readings: {
        fans: { kind: "use", source: "ducts.fans", retire: "target" },
      },
    },
    {
      sources: {
        "ducts.fans": composeSource({
          key: "ducts.roster",
          input: () => ({ body: { target } }),
          absent: null,
        }),
      },
      scope: {
        target: { kind: "document", ref: target },
        workKey: null,
        workRevision: null,
        page: {},
        work: null,
      },
      log() {},
    },
  );
  const release = graph.mount(["fans"]);
  return {
    graph,
    close: () => {
      release();
      graph.dispose();
    },
  };
};

// The SDK owner absorbs one mid-admission attachment frame (host sdk-session.test.ts). A 409 that
// still reaches the browser is a standing refusal: the read never retries it on its own.
test("the existing explicit refresh reacquires the read without retrying arbitrary conflicts", async () => {
  const f = fixture();
  try {
    await settle();
    expect(f.graph.get("fans")).toMatchObject({ status: "failed", current: false });
    expect(transport).toHaveBeenCalledTimes(1);
    f.graph.refresh(["fans"]);
    await settle();
    expect(f.graph.get("fans")).toMatchObject({
      status: "ready",
      current: true,
      value: { rows: [] },
    });
    expect(transport).toHaveBeenCalledTimes(2);
  } finally {
    f.close();
  }
});
