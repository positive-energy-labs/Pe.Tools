// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vite-plus/test";
import { Button } from "@pe/kit/lang/button";
import { Composer } from "./conversation";

afterEach(cleanup);
it("keeps the refusal under Send and places controls directly after the draft", () => {
  render(
    <Composer
      aria-label="Message"
      send={<Button label="send" />}
      onSend={() => {}}
      refusal="choose a provider"
      tools={<span>ready</span>}
    />,
  );
  const alert = screen.getByRole("alert");
  expect(alert.closest("[data-composer-send]")).toContain(
    screen.getByRole("button", { name: "send" }),
  );
  expect(alert.textContent).toBe("choose a provider");
  expect(screen.getByRole("textbox").nextElementSibling?.hasAttribute("data-composer-lead")).toBe(
    true,
  );
  expect(document.querySelector("[data-composer-refusal]")).toBeNull();
});
