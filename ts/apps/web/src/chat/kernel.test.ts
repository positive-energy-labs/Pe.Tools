// @vitest-environment jsdom
import { expect, test } from "vite-plus/test";
import { renderHook, waitFor } from "@testing-library/react";
import { useEnvironmentReading } from "#/shell/environment-readings";
import { RouteGraphJson } from "../../../../packages/agent-contracts/src/route-kernel-data";
import { chatData } from "./graph";
import { createChatFixture } from "./admission";
import { threadWorkSnapshotSchema } from "@pe/agent-contracts";

test("chat declares the admitted kernel contract without a legacy executable graph", () => {
  expect(RouteGraphJson.safeParse(chatData).success).toBe(true);
});
test("chat fixture keeps the actual thread Work snapshot in its admitted owner", async () => {
  const owner = await createChatFixture("send");
  try {
    const state = owner.readingStatus("threadWork").snapshot;
    expect(state.current, JSON.stringify(state)).toBe(true);
    expect(threadWorkSnapshotSchema.parse(state.value).threads.length).toBeGreaterThan(0);
  } finally {
    owner.dispose();
  }
});
test("thread Work fixture reaches the existing environment-reading hook", async () => {
  window.history.replaceState({}, "", "/pea?fixture=send");
  const view = renderHook(() => useEnvironmentReading({ kind: "thread-work" }, "threadWork"));
  try {
    await waitFor(() =>
      expect(view.result.current.reading.state, JSON.stringify(view.result.current)).toBe("ready"),
    );
  } finally {
    view.unmount();
  }
});
