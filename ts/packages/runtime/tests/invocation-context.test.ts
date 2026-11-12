import {
  withInvocationContext,
  contextFetch,
  invocationContext,
  carriesCallerContext,
} from "@pe/runtime/context";
import type { Caller } from "@pe/agent-contracts";
import { afterEach, expect, test, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each(["old-run", ""])(
  "async invocation freezes caller token or absence (%s) before the next turn",
  async (token) => {
    vi.stubEnv("PE_CONTEXT", token);
    const headers = { "x-other": "original" };
    const caller: Caller = { kind: "human", via: "local" };
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return Response.json({ ok: true });
    });
    const pending = withInvocationContext(
      { hostBaseUrl: "http://identity.test", headers, caller },
      async () => {
        await held;
        expect(invocationContext()?.caller).toBe(caller);
        expect(carriesCallerContext()).toBe(Boolean(token));
        await contextFetch("http://identity.test/actions");
        await contextFetch("http://external.test/docs");
      },
    );
    vi.stubEnv("PE_CONTEXT", "next-run");
    headers["x-other"] = "changed";
    release();
    await pending;
    expect(seen[0]!.get("x-pe-context")).toBe(token || null);
    expect(seen[0]!.get("x-other")).toBe("original");
    expect(seen[1]!.get("x-pe-context")).toBeNull();
  },
);

// ADR 0039 keep: a torn outbox used to throw a bare SyntaxError from every read, clear and write
// on its slot, and nothing named the file.
test("a torn outbox is refused with its file named and kept, and a re-read posts no second notice", async () => {
  const { readOutbox, writeOutbox } = await import("@pe/runtime/context");
  const { resolveLaneAndRoot, runtimeRoot } = await import("../src/runtime-owner.ts");
  const { readStoredNotices } = await import("@pe/host-contracts/store");
  const { createHash } = await import("node:crypto");
  const { join, dirname } = await import("node:path");
  const { mkdirSync, readFileSync, writeFileSync, rmSync } = await import("node:fs");
  const slot = `http://outbox.test/${crypto.randomUUID()}`;
  const file = join(
    runtimeRoot(),
    "state",
    resolveLaneAndRoot().serviceName,
    "invocation-outbox",
    `${createHash("sha256").update(slot).digest("hex")}.json`,
  );
  const posted = () =>
    readStoredNotices(join(runtimeRoot(), "state", "stored-notices.jsonl")).filter(
      (notice) => notice.path === file,
    );
  const torn = '{"id":"torn';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, torn);
  try {
    expect(() => readOutbox(slot)).toThrow(file);
    expect(() => readOutbox(slot)).toThrow("can't be read, so the file is kept");
    expect(() => writeOutbox(slot)).toThrow(file);
    expect(() => writeOutbox(slot, { id: crypto.randomUUID() })).toThrow(file);
    expect(readFileSync(file, "utf8")).toBe(torn);
    expect(posted()).toMatchObject([{ class: "keep", place: "Pending action" }]);
    // A person removes the file, and the slot works again.
    rmSync(file);
    expect(readOutbox(slot)).toBeUndefined();
  } finally {
    rmSync(file, { force: true });
  }
});

test("pre-ACK files keep causal evidence and unproven historical bytes; ACK stores only id", async () => {
  const { readOutbox, writeOutbox } = await import("@pe/runtime/context");
  const { resolveLaneAndRoot, runtimeRoot } = await import("../src/runtime-owner.ts");
  const { createHash } = await import("node:crypto");
  const { join } = await import("node:path");
  const { readFileSync, writeFileSync, unlinkSync } = await import("node:fs");
  const slot = `http://outbox.test/${crypto.randomUUID()}`;
  const record = {
    id: crypto.randomUUID(),
    admission: {
      id: "",
      key: "pod.export",
      target: { kind: "host" as const },
      input: { pod: "p", archivePath: "p.zip" },
    },
  };
  record.admission.id = record.id;
  const original = { headers: { "x-pe-context": "original-root-token" } };
  const later = { headers: { "x-pe-context": "later-root-token" } };
  const file = join(
    runtimeRoot(),
    "state",
    resolveLaneAndRoot().serviceName,
    "invocation-outbox",
    `${createHash("sha256").update(slot).digest("hex")}.json`,
  );
  try {
    withInvocationContext(original, () => writeOutbox(slot, record));
    const bytes = readFileSync(file, "utf8");
    expect(JSON.parse(bytes)).toMatchObject({
      ...record,
      contextHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(bytes).not.toContain("original-root-token");
    expect(() => withInvocationContext(later, () => writeOutbox(slot, { id: record.id }))).toThrow(
      "captured caller context",
    );
    expect(readFileSync(file, "utf8")).toBe(bytes);
    withInvocationContext(original, () => writeOutbox(slot, { id: record.id }));
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ id: record.id });
    expect(withInvocationContext(later, () => readOutbox(slot))).toEqual({ id: record.id });
    const historical = JSON.stringify(record);
    writeFileSync(file, historical);
    expect(() => withInvocationContext(original, () => readOutbox(slot))).toThrow(
      "unproven captured caller context",
    );
    expect(() => withInvocationContext(original, () => writeOutbox(slot))).toThrow(
      "unproven captured caller context",
    );
    expect(readFileSync(file, "utf8")).toBe(historical);
  } finally {
    unlinkSync(file);
  }
});
