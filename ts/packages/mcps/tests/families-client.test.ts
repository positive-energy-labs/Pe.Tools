import { afterEach, expect, test, vi } from "vite-plus/test";
import { address, bindWork } from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";
import { readFamiliesCapture } from "../src/shared/families-client.ts";

const target = { session: "families-session", openId: "project-open" };
const work = bindWork("families", address("C:/Models/Air.rvt"), undefined, target);
afterEach(() => vi.unstubAllGlobals());

test("Families cancel uses its query door and the exact document headers", async () => {
  const fetcher = vi.fn(async () => Response.json({ cancelled: true }));
  vi.stubGlobal("fetch", fetcher);
  const readId = crypto.randomUUID();
  expect(await readFamiliesCapture("families.cancel-read", { readId }, work, target)).toEqual({
    cancelled: true,
  });
  const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe("/families/readings");
  expect(init.method).toBe("DELETE");
  expect(JSON.parse(init.body as string)).toEqual({ readId });
  expect(new Headers(init.headers).get(HOST_RPC_BRIDGE_SESSION_HEADER)).toBe(target.session);
  expect(new Headers(init.headers).get(HOST_RPC_DOCUMENT_HEADER)).toBe(target.openId);
});

test("kernel gap: Families query refusals preserve host status and reason for the verb core", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ error: "The document lifetime changed" }, { status: 409 }),
  );
  await expect(
    readFamiliesCapture("families.cancel-read", { readId: crypto.randomUUID() }, work, target),
  ).rejects.toMatchObject({ status: 409, message: "The document lifetime changed" });
});
