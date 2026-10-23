// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { Button } from "@pe/kit/lang/button";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { Composer } from "./conversation";

afterEach(cleanup);
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
  const { container, rerender } = render(view(null));
  const draft = screen.getByRole("textbox");
  const send = screen.getByRole("button", { name: "send" });
  // base-ui stamps a `data-base-ui-inert` marker on the popup's ancestor siblings for outside-press
  // detection; it is a marker, not inert, so the comparison ignores it.
  const shape = (el: Element) => el.outerHTML.replace(/ data-base-ui-inert=""/g, "");
  const before = [shape(draft), shape(send)];
  rerender(view("choose a provider"));
  const alert = await screen.findByRole("alert");
  // The outcome lives under the control that asked (DOM locality) yet on the overlay plane.
  expect(alert.closest("[data-composer-send]")).toBeTruthy();
  expect(alert.closest('[data-slot="popover-content"]')).toBeTruthy();
  expect(alert.textContent).toBe("choose a provider");
  expect([shape(draft), shape(send)]).toEqual(before);
  for (const child of send.parentElement!.children)
    expect(child === send || (child as HTMLElement).style.position === "fixed").toBe(true);
  rerender(view(null));
  expect(screen.queryByRole("alert")).toBeNull();
});
