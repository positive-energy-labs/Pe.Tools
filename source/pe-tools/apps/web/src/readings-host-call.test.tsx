// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test } from "vite-plus/test";
import { useHostCall } from "./readings";

type Request = { identity: string; signal: AbortSignal; resolve: (value: string) => void };

test("dependency changes hide old data synchronously while refresh retains same-identity data", async () => {
  const requests: Request[] = [];
  const load = (identity: string, signal: AbortSignal) =>
    new Promise<string>((resolve) => requests.push({ identity, signal, resolve }));

  function Probe({ identity }: { identity: string }) {
    const query = useHostCall((signal) => load(identity, signal), [identity]);
    return (
      <div>
        <span>{query.data ?? (query.pending ? "loading" : "empty")}</span>
        <button type="button" onClick={query.refresh}>
          refresh
        </button>
      </div>
    );
  }

  const view = render(<Probe identity="A" />);
  await waitFor(() => expect(requests).toHaveLength(1));
  await act(async () => requests[0].resolve("result-A"));
  expect(view.container.textContent).toContain("result-A");

  fireEvent.click(view.getByText("refresh"));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(view.container.textContent).toContain("result-A");

  view.rerender(<Probe identity="B" />);
  expect(view.container.textContent).toContain("loading");
  expect(view.container.textContent).not.toContain("result-A");
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[1].signal.aborted).toBe(true);

  await act(async () => requests[1].resolve("late-A"));
  expect(view.container.textContent).not.toContain("late-A");
  await act(async () => requests[2].resolve("result-B"));
  expect(view.container.textContent).toContain("result-B");
});
