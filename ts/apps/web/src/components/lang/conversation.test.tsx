// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Composer } from "./conversation";

afterEach(cleanup);
it("portals Send's refusal without changing the draft or control row", async () => {
  const view = (refusal: string | null) => (
    <Composer
      aria-label="Message"
      send={
        <TooltipHint content="send">
          <Button label="send" />
        </TooltipHint>
      }
      onSend={() => {}}
      refusal={refusal}
      tools={<span>ready</span>}
    />
  );
  const { container, rerender } = render(view(null));
  const draft = screen.getByRole("textbox");
  const send = screen.getByRole("button", { name: "send" });
  const before = [draft.outerHTML, send.outerHTML];
  rerender(view("choose a provider"));
  const alert = await screen.findByRole("alert");
  expect(container.contains(alert)).toBe(false);
  expect(alert.closest('[data-slot="popover-content"]')).toBeTruthy();
  expect(alert.textContent).toBe("choose a provider");
  expect([draft.outerHTML, send.outerHTML]).toEqual(before);
  for (const child of send.parentElement!.children)
    expect(child === send || (child as HTMLElement).style.position === "fixed").toBe(true);
  rerender(view(null));
  expect(screen.queryByRole("alert")).toBeNull();
});
