import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { KeyHint } from "@pe/kit/lang/key-hint";
import { Button } from "@pe/kit/lang/button";
import { LeaderDiagram } from "@pe/kit/lang/leader-diagram";
import { SearchControl } from "@pe/kit/lang/search-control";
import { TooltipHint } from "@pe/kit/lang/tooltip";
import { useTeaching } from "@pe/kit/lang/use-teach";
import type { Teaching, TeachKey } from "@pe/kit/lang/teach";
import { useScopeKeys } from "@pe/kit/keys";
import { GestureKey } from "@pe/kit/lang/gesture-glyph";
import { HotkeyCommand } from "#/components/lang/hotkey-command";
import { startFeedback } from "#/components/feedback-picker";
import { SettingsHelpTrigger } from "#/machine/navigation";

const HELP_CHORD = { hotkey: "Alt+/", label: "How this tool works" } as const;
function Keys({ facts }: { facts: readonly Teaching[] }) {
  const unique = new Map<string, TeachKey>();
  for (const fact of facts)
    if (fact.kind === "keys")
      for (const item of fact.items) {
        if (item.label === HELP_CHORD.label) continue;
        const id = `${fact.scope}:${item.keys?.join("+").replaceAll("Escape", "Esc") ?? ""}:${item.pointer ?? ""}`;
        if (!unique.has(id) || !fact.gestures) unique.set(id, item);
      }
  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 t-small">
      {[...unique].map(([id, item]) => (
        <div key={id} className="flex items-center gap-2">
          <dt>
            <GestureKey keys={item.keys} pointer={item.pointer} />
          </dt>
          <dd data-tone={item.refusal ? "caution" : undefined}>
            {item.says ?? item.label}
            {item.refusal ? ` — refuses now: ${item.refusal}` : ""}
          </dd>
        </div>
      ))}
    </dl>
  );
}
function Choices({ fact }: { fact: Extract<Teaching, { kind: "modes" | "views" }> }) {
  const views = fact.kind === "views";
  return (
    <div
      aria-label={fact.label}
      data-teach-views={views || undefined}
      className={views ? "grid grid-cols-2 gap-1 t-small" : "flex flex-wrap gap-1 t-small"}
    >
      {fact.options.map((o) => (
        <TooltipHint key={o.key} content={o.says}>
          <span
            tabIndex={0}
            aria-current={o.active ? "true" : undefined}
            aria-disabled={o.disabled || undefined}
            data-teach-place={o.place}
            aria-label={o.label}
            className={
              views
                ? "hairline-x hairline-y p-1"
                : o.active
                  ? "on-select px-1 font-semibold"
                  : "px-1 text-ink-2"
            }
            style={
              o.place
                ? { gridColumn: o.place[1] === "l" ? 1 : 2, order: o.place[0] === "t" ? 0 : 1 }
                : undefined
            }
          >
            {o.label}
            {views ? ` · ${o.active ? "shown" : "available"}` : o.active ? " · active" : ""}
          </span>
        </TooltipHint>
      ))}
    </div>
  );
}
export function HelpWorld({ facts }: { facts: readonly Teaching[] }) {
  const areas = facts.filter((f) => f.kind === "region");
  facts = facts.filter((f) => !f.region || areas.some((r) => r.id === f.region));
  if (facts.some((f) => f.kind !== "keys" && !f.region))
    areas.push({ kind: "region", id: "tool", label: "tool" });
  return (
    <div className="flex flex-col gap-4 px-8">
      <Keys facts={facts.filter((f) => !f.region)} />
      <div className="flex flex-wrap items-start gap-4">
        {areas.map((r, i) => {
          const own = facts.filter((f) => (f.region ?? "tool") === r.id);
          const pane = document.querySelector<HTMLElement>(`[data-teach-id="${r.id}"]`);
          const views = new Map(
            own.flatMap((f) =>
              f.kind === "views" ? f.options.map((o) => [o.key, o] as const) : [],
            ),
          );
          return (
            <section
              key={r.id}
              aria-label={r.label}
              className="hairline-x hairline-y flex min-w-0 flex-col gap-2 p-2"
              style={{ flex: `${pane?.getBoundingClientRect().width || 1} 1 20rem` }}
            >
              <h2 className="t-small t-upper">
                {i + 1} {r.label}
              </h2>
              {r.purpose ? <p className="t-small text-ink-2">{r.purpose}</p> : null}
              {own
                .filter(
                  (f) =>
                    !(f.kind === "search" && f.label === "Search") ||
                    !own.some((s) => s.kind === "search" && s.label !== "Search"),
                )
                .map((f) =>
                  f.kind === "search" ? (
                    <div key={f.id} data-teach-search="" className="t-small">
                      <LeaderDiagram
                        label={`${f.label} syntax`}
                        track={
                          <SearchControl>
                            <span className="truncate text-ink-2">{f.label} …</span>
                          </SearchControl>
                        }
                        items={[
                          ...f.syntax.map((line) => ({ key: line, at: [0.5], label: line })),
                          ...f.fields.map((field, index) => ({
                            key: field.label,
                            at: [(index + 0.5) / f.fields.length],
                            label: `${field.label} · ${field.operators.join(" / ")} · ${field.examples.join("; ")}`,
                          })),
                        ]}
                      />
                    </div>
                  ) : f.kind === "modes" ? (
                    <Choices key={f.id} fact={f} />
                  ) : null,
                )}
              {views.size ? (
                <Choices
                  fact={{
                    kind: "views",
                    id: r.id,
                    label: "views and layers",
                    options: [...views.values()],
                  }}
                />
              ) : null}
              <Keys facts={own.filter((f) => f.region)} />
            </section>
          );
        })}
      </div>
    </div>
  );
}
function HelpBody({
  docs,
  name,
  utilities,
  close,
}: {
  docs: ReactNode;
  name: string;
  utilities?: boolean;
  close: () => void;
}) {
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
          {docs}
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

/** AppChrome binds once on the document, including inputs. */
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

export function RouteHelpButton({
  docs,
  name,
  utilities = false,
}: {
  docs?: ReactNode;
  name: string;
  utilities?: boolean;
}) {
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
          <HelpBody docs={docs} name={name} utilities={utilities} close={() => setOpen(false)} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
