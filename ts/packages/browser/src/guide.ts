export const browserSkillName = "use-browser";

/** One guide for the standalone CLI and the bundled Pea skill. No browser connection required. */
export function renderBrowserGuide(command: "pe-browser" | "pea browser" = "pe-browser"): string {
  return `---
name: ${browserSkillName}
description: Operate and inspect Chrome through Pea browser CDP for web tasks, rendered UI verification, network diagnosis, and browser regressions. Use for browser navigation, forms, screenshots, gestures, or observing a web app.
---

# Use the browser

Use ${command} for shell work and @pe/browser for typed Node programs. The same session and page contracts back both. Start with ${command} --help; ${command} guide prints this guide without starting a browser or host. Method signatures belong to ${command} help SESSION Domain.method, which reports its schema provenance. A bundled-reference marked unverified is a reference, not evidence that this Chrome supports every method. Raw CDP remains available for commands beyond the pinned types.

## Choose what answers the question

Read DOM or Accessibility for content, labels, controls, and state. Use a screenshot for geometry, overlays, canvas, images, or what a person actually sees; open the captured image before making visual claims. Inspect Network for requests, responses, and bodies; Runtime for console messages and exceptions. A blank-looking page needs these observations before a diagnosis. Derive element identities from data rather than pixels.

The hot path is locate, trusted input, independent read-back. Inspect the intended control and its current state; compute its visible bounding rectangle; dispatch Input at its viewport coordinates; then read the resulting DOM, selected values, navigation, or response. A successful CDP return proves dispatch, not the user's outcome. For a form submission, check a confirmation or durable result before submitting again. Read-only inspection usually needs fewer actions than clicking through everything.

Wait for a bounded observable condition: a target control, application state, matching response, or navigation event. Subscribe before acting when an event could race the action. Do not insert arbitrary sleeps. A timeout or abort with outcome unknown means Chrome may have acted. Inspect current state and the request journal before retrying a mutation. Navigation destroys evaluation contexts; inspect the new page before deciding whether work remains.

## Start and target explicitly

    ${command} launch
    ${command} targets SESSION
    ${command} help SESSION Page.navigate
    ${command} SESSION Page.navigate --target TARGET --params-file navigate.json
    ${command} status SESSION
    ${command} stop SESSION

navigate.json contains {"url":"https://example.com"}. Use the returned session and target ids, and keep them explicit on subsequent commands. Re-enumerate targets after tabs change. --params-file FILE or --params-stdin carries structured JSON safely, especially in PowerShell; avoid embedding JSON in shell arguments. --home DIR isolates receipts; repeat the same --home DIR on every command for that session. --browser is privileged browser-level raw CDP, with effects outside a single page lease.

Launch defaults to headless with a private temporary profile. Use --visible when a person needs the window. Performance and visual timing measurements require a visible foreground page; record that condition. Do not compare those measurements with a hidden or background tab.

An explicit --profile DIR retains a dedicated automation profile and its sign-in state. Retain it only when the task calls for persistence. Attaching to daily Chrome requires the person's consent through Chrome's remote-debugging UI; the agent cannot approve that prompt. Google sign-in remains a manual human step. Do not clone a daily profile or extract credentials to work around consent or sign-in.

## Typed evaluation and trusted gestures

For repeated inspection, write a short typed program with @pe/browser. Both BrowserPage and CdpClient support evaluate(fn, ...args). The callback executes in Chrome, so it must be self-contained. Pass Node values as explicit arguments; closures are not transferred. The awaited result and arguments must be plain JSON, including named DTOs and arrays. Return null for absent values, not undefined.

    const state = await page.evaluate((selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { text: node.textContent, x: r.x + r.width / 2,
        y: r.y + r.height / 2, width: r.width, height: r.height };
    }, "button[type=submit]");

Evaluation rejects unsupported values such as functions, bigint, non-finite numbers, cycles, accessors, class instances, and sparse arrays. Local argument failures are not-sent. Callback/result failures have unknown outcome because the callback may already have acted. Read the original error, data.phase, and data.path; evaluation never retries automatically. Raw Runtime.evaluate remains available when a protocol-specific expression or remote object is needed.

For a click, send Input.dispatchMouseEvent mousePressed then mouseReleased with button left and clickCount 1. Input coordinates are CSS pixels relative to the viewport, including when Chrome routes them into an iframe; do not add document scroll offsets. Re-read geometry after scrolling or layout changes. Input.insertText types into the focused control; dispatchKeyEvent provides explicit keyDown/keyUp. Verify the controlled input's actual value afterward.

For wheel input, locate the intended scroll container and dispatch mouseWheel with x, y, deltaX, deltaY. Read its scroll position or visible content afterward. For a drag, press with button left and buttons 1, move through bounded viewport points with buttons 1, then release with buttons 0. Ensure release in cleanup if interrupted. A synthetic element.click() can bypass the native input path; use trusted Input for UI behavior claims and when synthetic input silently does nothing.

## Observe failures and keep the observer alive

Use a persistent page connection for events and response-body retrieval. Subscribe through page.subscribe, enable the relevant domains, perform the action, and retain that connection until the needed events and bodies have been read. Request ids and buffered response bodies belong to that observation lifetime; separate one-shot calls do not recreate it. CLI events provides a bounded event stream; use a typed program when actions and body retrieval must share one observer.

Watch Runtime.exceptionThrown and Network.loadingFailed alongside the success events that answer the task. Otherwise silence can hide an exception or failed request. Add Runtime.consoleAPICalled when console output matters. Filter subscriptions to events you will act on, correlate requests by id, and give waits a deadline. No harness-specific Monitor tool is required.

## Release what this task acquired

A page lease is exclusive across clients of the same session. Use another target for independent work. Release pages before session.disconnect() to leave their tabs available for the next client. Disconnect ends this client's connection; it does not mean the browser was stopped.

Use browser.close() to end an owned session. Attached cleanup closes only tabs this library created and disconnects; release borrowed tabs instead of closing them. Raw CDP is privileged, so custody is not a security sandbox. After CLI stop, list excludes the closed session and status SESSION reports SessionClosed. Preserve user tabs and any explicitly retained session; report its id and why it remains.

Put observer disposal, page release, and session/browser cleanup in finally. A Node readline driver must also close its interface and pause input in finally when it owns stdin. An open input handle can keep the driver alive after browser cleanup; inspect handles before calling that a browser leak.

## Guard a concrete product bug

When fixing repo-owned browser behavior, reproduce the reported bug with fixed local inputs and the actual rendered control. Use a typed callback program to locate and read state, trusted gestures to trigger the failure, and an independent read-back to assert the meaningful invariant. Calibrate the guard against the broken behavior, then restore the fix and run it again. Put the bounded regression in the required product gate. Do not add hypothetical cases or replace a real control with injected success state. A fixture browser check proves that route's behavior; it does not prove Revit mutation or installed operation.

Method lineage: the sense/act/read-back loop, separate action and observation channels, live protocol discovery, and explicit cleanup adapt [chrome-agent's agent guide](https://github.com/captivus/chrome-agent/blob/ab3f3be6ef4c3be85546bf84aa8282b98456b97b/AGENTS.md) and its bundled guide command. Pea's leases, JSON evaluation, custody, and cleanup contracts above govern this implementation.
`;
}
