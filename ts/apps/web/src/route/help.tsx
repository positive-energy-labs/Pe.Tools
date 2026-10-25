import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { KeyHint } from "@pe/kit/lang/key-hint";
import { Button } from "@pe/kit/lang/button";
import { LeaderDiagram } from "@pe/kit/lang/leader-diagram";
import { Deferred } from "@pe/kit/lang/section";
import { TeachLive, useTeaching } from "@pe/kit/lang/use-teach";
import { measureRegions, type Teaching, type TeachKey } from "@pe/kit/lang/teach";
import { useScopeKeys } from "@pe/kit/keys";
import { GestureKey } from "@pe/kit/lang/gesture-glyph";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { startFeedback } from "#/components/feedback-picker";
import { SettingsHelpTrigger } from "#/machine/navigation";
type HelpProps = { docs?: ReactNode; name: string; utilities?: boolean };
const HELP_CHORD = { hotkey: "Alt+/", label: "How this tool works" } as const;
function Details({ facts }: { facts: readonly Teaching[] }) {
  const rows = new Map<string, { term: ReactNode; text: ReactNode; refusal?: string | null }>();
  const keys = new Map<string, TeachKey>();
  for (const f of facts) {
    if (f.kind === "keys")
      for (const item of f.items) {
        if (item.label === HELP_CHORD.label) continue;
        const id = `${f.scope}:${item.keys?.join("+").replaceAll("Escape", "Esc") ?? ""}:${item.pointer ?? ""}`;
        if (!keys.has(id) || !f.gestures) keys.set(id, item);
      }
    if (
      f.kind === "search" &&
      (f.label !== "Search" || !facts.some((s) => s.kind === "search" && s.label !== "Search"))
    ) {
      f.syntax.forEach((text, i) => rows.set(`${f.id}:${i}`, { term: i ? null : f.label, text }));
      f.fields.forEach((field) =>
        rows.set(`${f.id}:${field.label}`, {
          term: field.label,
          text: `${field.operators.join(" / ")}; ${field.examples.join("; ")}`,
        }),
      );
    }
    if (f.kind === "modes" || f.kind === "views")
      for (const o of f.options) {
        const state =
          f.source === "reference"
            ? ""
            : f.kind === "views"
              ? o.active
                ? "shown"
                : "available"
              : o.active
                ? "active"
                : "";
        rows.set(`${f.kind === "views" ? "views" : f.id}:${o.key}`, {
          term: (
            <span
              aria-label={o.label}
              aria-current={o.active ? "true" : undefined}
              aria-disabled={o.disabled || undefined}
              data-teach-place={o.place}
            >
              {o.label}
              {state ? ` \u00b7 ${state}` : ""}
            </span>
          ),
          text: o.says,
        });
      }
  }
  keys.forEach((item, id) =>
    rows.set(id, {
      term: <GestureKey keys={item.keys} pointer={item.pointer} />,
      text: item.says ?? item.label,
      refusal: item.refusal,
    }),
  );
  return (
    <dl
      data-teach-keys=""
      className="t-small"
      data-teach-search={facts.some((f) => f.kind === "search") || undefined}
    >
      {[...rows].map(([id, row]) => (
        <div key={id} className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-2">
          <dt>{row.term}</dt>
          <dd data-tone={row.refusal ? "caution" : undefined}>
            {row.text}
            {row.refusal ? ` \u2014 refuses now: ${row.refusal}` : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function HelpWorld({ facts }: { facts: readonly Teaching[] }) {
  const picture = measureRegions(facts);
  const global = facts.filter((f) => f.kind === "keys" && !f.region);
  const scopes = [...new Set(global.flatMap((f) => (f.kind === "keys" ? [f.scope] : [])))];
  return (
    <div
      className="px-4 sm:px-8"
      data-teach-source={facts.some((f) => f.source === "reference") ? "reference" : "measured"}
    >
      {facts.some((f) => f.source === "reference") ? (
        <p className="mb-4 t-small text-ink-2">
          Reference layout · controls described here take effect once loaded. Current visibility and
          availability are not yet measured.
        </p>
      ) : null}
      <div
        data-teach-legend=""
        className="mb-6 grid max-w-5xl grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4"
      >
        {scopes.map((scope) => (
          <section key={scope} aria-label={scope}>
            <h2 className="t-small t-upper">{scope}</h2>
            <Details facts={global.filter((f) => f.kind === "keys" && f.scope === scope)} />
          </section>
        ))}
      </div>
      {picture.regions.length ? (
        <LeaderDiagram label="Page regions" picture={picture} items={picture.regions}>
          {picture.regions.map((r, i) => (
            <section
              key={r.key}
              data-key={r.key}
              aria-label={r.label}
              className="flex w-full min-w-0 flex-col gap-2 t-small wrap-anywhere"
              style={{ gridColumn: i % 2 ? 3 : 1, gridRow: Math.floor(i / 2) + 1 }}
            >
              <h2 className="t-small t-upper">
                {i + 1} {r.label}
              </h2>
              {facts.map((f) =>
                f.kind === "region" && f.id === r.key && f.purpose ? (
                  <p key={f.id}>{f.purpose}</p>
                ) : null,
              )}
              <Details facts={facts.filter((f) => f.region === r.key)} />
            </section>
          ))}
        </LeaderDiagram>
      ) : null}
    </div>
  );
}
function HelpBody({ docs, name, utilities, close }: HelpProps & { close: () => void }) {
  const facts = useTeaching();
  return (
    <div className="absolute inset-0 flex flex-col gap-3 overflow-y-auto">
      <div className="flex items-baseline gap-3 px-8 pt-6">
        <span className="t-title text-ink">{name}</span>
        <KeyHint>Alt+/</KeyHint>
      </div>
      <HelpWorld facts={facts} />
      {docs ? (
        <div
          className="px-8 pt-3 pb-8 t-prose"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("a")) close();
          }}
        >
          <Deferred>{docs}</Deferred>
        </div>
      ) : null}
      {utilities ? (
        <div className="hairline-t flex items-center gap-3 px-8 py-3">
          <Button
            label="Send feedback"
            onClick={() => {
              close();
              startFeedback();
            }}
          >
            Send feedback
          </Button>
          <SettingsHelpTrigger onOpen={close} />
        </div>
      ) : null}
    </div>
  );
}
/** Navigation can mount several openers; the newest owns Help. */
const openers: (() => void)[] = [];
export function HelpChord() {
  useScopeKeys(
    [
      {
        hotkey: HELP_CHORD.hotkey,
        label: HELP_CHORD.label,
        callback: () => openers.at(-1)?.(),
        options: { ignoreInputs: false },
      },
    ],
    document.documentElement,
  );
  return null;
}
export function RouteHelpButton({ docs, name, utilities = false }: HelpProps) {
  const [open, setOpen] = useState(false);
  // Focus the page itself, not its first tabbable (a footer button) that would scroll it to the end.
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = () => setOpen(true);
    openers.push(opener);
    return () => void openers.splice(openers.indexOf(opener), 1);
  }, []);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={
          <HotkeyCommand
            bind={false}
            label={HELP_CHORD.label}
            word="Tutorial"
            hotkey={HELP_CHORD.hotkey}
            reason="how this tool works — its regions and every key bound right now (Alt+/)"
            invoke={() => setOpen(true)}
          />
        }
      />
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          ref={popup}
          initialFocus={popup}
          className="fixed inset-0 z-modal outline-none"
        >
          <div data-surface="page" className="absolute inset-0" onClick={() => setOpen(false)} />
          <TeachLive value={false}>
            <HelpBody docs={docs} name={name} utilities={utilities} close={() => setOpen(false)} />
          </TeachLive>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
