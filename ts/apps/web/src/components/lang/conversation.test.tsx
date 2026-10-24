// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Composer, MessageBubble } from "./conversation";

afterEach(cleanup);
it("gives user messages the theme-aware artifact ground", () => {
  render(<MessageBubble>your message</MessageBubble>);
  expect(screen.getByText("your message").getAttribute("data-surface")).toBe("artifact");
});
it("keeps Send's refusal under Send on the overlay plane without changing the draft or control row", async () => {
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
  const { rerender } = render(view(null));
  const draft = screen.getByRole("textbox");
  const send = screen.getByRole("button", { name: "send" });
  const shape = (el: Element) => el.outerHTML.replace(/ data-base-ui-inert=""/g, "");
  const before = [shape(draft), shape(send)];
  rerender(view("choose a provider"));
  const alert = await screen.findByRole("alert");
  expect(alert.closest("[data-composer-send]")).toBeTruthy();
  expect(alert.closest('[data-slot="popover-content"]')).toBeTruthy();
  expect(alert.textContent).toBe("choose a provider");
  expect([shape(draft), shape(send)]).toEqual(before);
  for (const child of send.parentElement!.children)
    expect(
      child === send ||
        child.hasAttribute("data-base-ui-portal") ||
        (child as HTMLElement).style.position === "fixed",
    ).toBe(true);
  rerender(view(null));
  expect(screen.queryByRole("alert")).toBeNull();
});
