/** DOM-only: cdp.ts evaluates this exact predicate in the page; jsdom exercises it too. */
export function composerTurn(): {
  state: "absent" | "working" | "settled" | "failed";
  detail: string;
} {
  const composer = Array.from(document.querySelectorAll<HTMLElement>("[data-composer-scope]")).find(
    (scope) => {
      for (let node: HTMLElement | null = scope; node; node = node.parentElement)
        if (node.hidden || node.hasAttribute("inert") || node.style.display === "none")
          return false;
      return true;
    },
  );
  const actions = composer?.querySelector("[data-composer-send]");
  if (!actions) return { state: "absent", detail: "" };
  const refusal = actions.querySelector('[data-kind="refused"], [data-kind="error"]');
  if (refusal) return { state: "failed", detail: refusal.textContent?.trim() ?? "" };
  // The running composer replaces Send with Stop; a question offers Answer beside Stop.
  const asking = actions.querySelector('button[aria-label="Answer Pea\'s question"]');
  if (!asking && actions.querySelector('button[aria-label="stop"], button[aria-busy="true"]'))
    return { state: "working", detail: "" };
  return {
    state: asking || actions.querySelector('button[aria-label="Send"]') ? "settled" : "absent",
    detail: "",
  };
}
