# @pe/browser

Direct CDP for library callers and shell agents. Commands and sessions use the same public implementation. Known commands use type-only upstream `devtools-protocol` mappings; `sendRaw` forwards methods absent from those types. No Playwright or Python runtime is used.

```ts
import { openBrowser } from "@pe/browser";

const browser = await openBrowser({ mode: "headless" });
try {
  const page = await browser.page({ url: "https://example.com" });
  const result = await page.send("Runtime.evaluate", {
    expression: "document.title",
    returnByValue: true,
  });
  console.log(result.result.value);
} finally {
  await browser.close();
}
```

From `ts`, `node packages/browser/src/cli.ts --help` prints the CLI surface. `launch` defaults to headless; `--visible` creates a window, `--profile DIR` retains an explicitly selected automation profile. CLI launches persist across invocations. Use `--home DIR` to isolate session receipts and `stop SESSION` to retire them. `help SESSION Page.navigate` uses the connected browser's live HTTP schema when available. If approval-mode Chrome returns HTTP 404, the session may provide the pinned bundled reference with explicit `bundled-reference` provenance and `unverified` compatibility. This reference cannot certify the connected browser's complete command set. `--schema` exposes the same provenance. Raw calls require `--target TARGET` or explicit privileged `--browser`; pass structured parameters through `--params-file FILE` or `--params-stdin`.

```powershell
pnpm exec pe-browser launch --visible
pnpm exec pe-browser targets SESSION
pnpm exec pe-browser help SESSION Page.navigate
pnpm exec pe-browser SESSION Page.navigate --target TARGET --params-file navigate.json
pnpm exec pe-browser status SESSION
pnpm exec pe-browser stop SESSION
```

`navigate.json` contains `{"url":"https://example.com"}`. Use the returned session and target ids. `status` reads effective closure from terminal and guardian publications; an immutable `session.json` readiness record alone is not a liveness check. Session directories also contain the command journal for correlating reported request ids and unknown outcomes.

`attachBrowser` accepts an explicit CDP endpoint or human-enabled modern Chrome discovery. A page lease is exclusive across clients of one session; another target can proceed independently. `release` ends the lease. `close` can retire only library-created tabs; a borrowed tab must be released. Session cleanup closes created tabs and disconnects from an attached browser. Browser-level raw CDP is privileged and can change foreign state; custody is a lifecycle boundary, not a protocol security sandbox.

Default session storage is `productRoot()/state/browser`, including the canonical product-home override. Attachment exclusion uses the canonical OS-user product state namespace instead, so different explicit browser homes or product-home overrides cannot create competing keepers for the same browser. Chrome's own profile discovery remains separate from product storage.

Promise CDP and scoped Effect acquisition use the same transport. Errors expose `code`, `method`, `requestId`, and `outcome` where applicable. An `unknown` outcome means Chrome may have acted; inspect state before retrying a mutation. Caller cancellation and timeouts never replay commands.

`pnpm --filter @pe/browser check:typing` compiles public consumer examples, including invalid known-command parameters that must remain type errors; it runs no browser. A7 native acceptance writes `<receipt>-a7-trace.jsonl` with phases, actual commands, DOM geometry read-backs, and the last protocol event at a failure.

Run `pnpm test:browser` for real process/browser acceptance. It creates only isolated test profiles and an owned native HTTP fixture. The [browser ledger](../../../docs/features/browser/LEDGER.md) records the completed real daily Chrome consent proof and the separate manual Google sign-in checkpoint. `pnpm test:browser:product` typechecks and runs the required headless product selection case against fixed local data; `pnpm verify` includes that uncached gate. The longer visible route replay is `pnpm journey:routes`; its source must stay quiet during measurement. See the [e2e runbook](../../tests/e2e/README.md) for the two product lanes.
