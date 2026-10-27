// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createPortal } from "react-dom";
import { use } from "react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { Button } from "../src/components/lang/button";
import { Pane, PaneWork, useWork } from "../src/components/lang/pane";

afterEach(cleanup);

it("ignores domain work ids and derives the Suspense read until it settles", async () => {
  let finish!: () => void;
  const read = new Promise<void>((resolve) => {
    finish = resolve;
  });
  function Reading() {
    use(read);
    return <div data-work="suggestion-id">ready</div>;
  }
  await act(async () => {
    render(
      <Pane title="schedule">
        <Reading />
      </Pane>,
    );
  });
  expect(await screen.findByText("loading schedule…")).toBeTruthy();
  await act(async () => finish());
  await waitFor(() => expect(document.querySelector('[data-slot="pane-work"]')).toBeNull());
  expect(screen.getByText("ready")).toBeTruthy();
});

it("registers one chip, clears it, and keeps nested panes separate", async () => {
  const view = (pending: boolean) => (
    <Pane title="outer">
      <div aria-busy data-work-label="attributes are accessibility only" />
      <PaneWork pending={pending} label="capturing meshes… gestures wait" />
      <PaneWork pending={pending} />
      <Pane title="inner">
        <PaneWork label="inner read" />
      </Pane>
    </Pane>
  );
  const { container, rerender } = render(view(true));
  const outer = screen.getByRole("region", { name: "outer" });
  await waitFor(() =>
    expect(
      outer.querySelector(':scope > [data-slot="pane-field"] > [data-slot="pane-work"]')
        ?.textContent,
    ).toBe("capturing meshes… gestures wait · reading…"),
  );
  expect(container.querySelectorAll('[data-slot="pane-work"]')).toHaveLength(2);
  expect(outer.querySelector('[data-slot="pane-field"]')?.getAttribute("data-working")).toBe(
    "true",
  );
  rerender(
    <Pane title="outer">
      <Pane title="inner">
        <PaneWork label="inner read" />
      </Pane>
    </Pane>,
  );
  await waitFor(() =>
    expect(
      outer.querySelector(':scope > [data-slot="pane-field"] > [data-slot="pane-work"]'),
    ).toBeNull(),
  );
  expect(container.querySelectorAll('[data-slot="pane-work"]')).toHaveLength(1);
});

it("registers portal work with the pane and removes it when the descendant unmounts", async () => {
  function BusyPortal() {
    useWork(true, "reading choices…");
    return createPortal(<div aria-busy />, document.body);
  }
  const { rerender } = render(
    <Pane>
      <BusyPortal />
    </Pane>,
  );
  expect(await screen.findByText("reading choices…")).toBeTruthy();
  rerender(<Pane>ready</Pane>);
  await waitFor(() => expect(screen.queryByText("reading choices…")).toBeNull());
});

it.each(["onPress", "onClick"] as const)(
  "owns %s promise busy state, prevents repeat presses and shows its receipt",
  async (prop) => {
    let finish!: () => void;
    const press = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <Pane>
        <Button label="capture" busy={false} {...{ [prop]: press }}>
          capture
        </Button>
      </Pane>,
    );
    const button = screen.getByRole("button", { name: "capture" });
    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(press).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(document.querySelector('[data-slot="pane-work"]')?.textContent).toBe("capture…"),
    );
    await act(async () => finish());
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(await screen.findByText("capture complete")).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-slot="pane-work"]')).toBeNull());
  },
);

it.each(["refused", "error"] as const)(
  "shows a %s outcome under its button with alert semantics",
  async (kind) => {
    render(
      <Button
        label="send"
        onPress={async () => {
          if (kind === "error") throw new Error("cannot send");
          return { message: "cannot send" };
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("cannot send");
    expect(alert.getAttribute("data-kind")).toBe(kind);
    expect(screen.getByRole("button", { name: "send" }).hasAttribute("aria-busy")).toBe(false);
  },
);
