import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { KeyHint } from "@pe/kit/lang/key-hint";
import { Button } from "@pe/kit/lang/button";
import { PageMap } from "@pe/kit/lang/page-map";
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
const keyIdentity = (item: TeachKey, source?: "reference") =>
  JSON.stringify([item.keys, item.pointer, item.label, item.says, item.refusal ?? null, source]);
function Details({ facts }: { facts: readonly Teaching[] }) {
  const rows = new Map<string, { term: ReactNode; text: ReactNode; refusal?: string | null }>();
  const keys = new Map<string, TeachKey>();
  for (const f of facts) {
    if (f.kind === "keys")
      for (const item of f.items) {
        if (item.label === HELP_CHORD.label) continue;
        const id = `${f.scope}:${keyIdentity(item, f.source)}`;
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
                : o.active === false && !o.disabled
                  ? "available"
                  : ""
              : o.active
                ? "active"
                : "";
        rows.set(`${f.kind === "views" ? "views" : f.id}:${o.key}`, {
          term: (
            <span
              aria-label={o.label}
              aria-current={f.source !== "reference" && o.active ? "true" : undefined}
              aria-disabled={(f.source !== "reference" && o.disabled) || undefined}
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
  if (!rows.size)
    return <p className="t-small text-ink-2">No additional controls are described here.</p>;
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
  const regions = facts.flatMap((fact) =>
    fact.kind === "region" ? [{ ...fact, key: fact.id }] : [],
  );
  const [picked, setPicked] = useState<string>();
  const selected =
    regions.find((region) => region.key === picked) ??
    regions.find((region) => region.visibility === "visible") ??
    regions[0];
  const map = {
    ...picture,
    regions: [
      ...picture.regions.map((region) => ({
        ...region,
        ordinal: String(regions.findIndex((entry) => entry.key === region.key) + 1),
      })),
      ...picture.rails.map((rail) => ({ ...rail, ordinal: "" })),
    ],
  };
  const global = facts.filter((f) => f.kind === "keys" && !f.region);
  const scopes = [...new Set(global.flatMap((f) => (f.kind === "keys" ? [f.scope] : [])))];
  const keys = new Map<
    string,
    { item: TeachKey; source?: "reference"; regions: Set<string>; uses: Set<string> }
  >();
  for (const fact of facts) {
    const region = regions.find((region) => region.key === fact.region);
    if (fact.kind !== "keys" || !region) continue;
    for (const item of fact.items) {
      const id = keyIdentity(item, fact.source);
      const entry = keys.get(id) ?? {
        item,
        source: fact.source,
        regions: new Set<string>(),
        uses: new Set<string>(),
      };
      entry.regions.add(region.key);
      entry.uses.add(
        `${region.label}${fact.scope.toLowerCase() === region.label.toLowerCase() ? "" : ` / ${fact.scope}`}`,
      );
      keys.set(id, entry);
    }
  }
  const shared = new Map<string, Extract<Teaching, { kind: "keys" }>>();
  const sharedKeys = new Set<string>();
  for (const [id, entry] of keys) {
    if (entry.regions.size < 2) continue;
    sharedKeys.add(id);
    const scope = [...entry.uses].sort().join(" · ");
    const groupId = `${entry.source ?? "measured"}:${scope}`;
    const group = shared.get(groupId) ?? {
      kind: "keys",
      id: groupId,
      scope,
      source: entry.source,
      items: [],
    };
    shared.set(groupId, { ...group, items: [...group.items, entry.item] });
  }
  const local = facts
    .filter((fact) => fact.region === selected?.key)
    .map((fact) =>
      fact.kind === "keys"
        ? {
            ...fact,
            items: fact.items.filter((item) => !sharedKeys.has(keyIdentity(item, fact.source))),
          }
        : fact,
    );
  return (
    <div
      className="@container px-4 sm:px-8"
      data-teach-source={regions.some((f) => f.source === "reference") ? "reference" : "measured"}
    >
      {regions.some((f) => f.source === "reference") ? (
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
      {selected ? (
        <div className="flex flex-col gap-6" data-teach-foldout="">
          <div className="grid grid-cols-1 items-start gap-6 @min-[40rem]:grid-cols-2">
            <PageMap
              picture={map}
              value={selected.rail?.id ?? selected.key}
              onValueChange={(key) => {
                const region =
                  regions.find((region) => region.key === key) ??
                  regions.find((region) => region.rail?.id === key);
                if (region) setPicked(region.key);
              }}
            />
            <div className="flex flex-col gap-3" aria-label="Region index">
              {regions.map((r, i) => (
                <section
                  key={r.key}
                  data-teach-node={r.key}
                  aria-label={r.label}
                  className="flex min-w-0 flex-col gap-1 t-small wrap-anywhere"
                >
                  <h2 className="t-small t-upper">
                    <Button
                      label={`Read ${r.label} controls`}
                      pressed={selected.key === r.key}
                      onClick={() => setPicked(r.key)}
                    >
                      {i + 1} {r.label}
                    </Button>
                  </h2>
                  {r.visibility === "folded" || r.available === false ? (
                    <p className="t-small text-ink-2">
                      {[
                        r.visibility === "folded" ? "Folded in workspace" : "",
                        r.available === false ? (r.refusal ?? "Unavailable in this scope") : "",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}
                  {facts.map((f) =>
                    f.kind === "region" && f.id === r.key && f.purpose ? (
                      <p key={f.id}>{f.purpose}</p>
                    ) : null,
                  )}
                </section>
              ))}
            </div>
          </div>
          <div className="hairline-t grid grid-cols-1 items-start gap-6 pt-4 @min-[40rem]:grid-cols-2">
            <section aria-label="Shared controls" data-teach-shared="">
              <h2 className="mb-2 t-small t-upper">Shared controls</h2>
              {shared.size ? (
                [...shared].map(([id, group]) => (
                  <div key={id} className="mb-4 flex flex-col gap-2">
                    <p className="t-small text-ink-2">
                      {group.scope}
                      {group.source === "reference" ? " · declared" : ""}
                    </p>
                    <Details facts={[group]} />
                  </div>
                ))
              ) : (
                <p className="t-small text-ink-2">Controls are listed with their region.</p>
              )}
            </section>
            <section aria-label={`${selected.label} controls`} data-teach-detail={selected.key}>
              <h2 className="mb-2 t-small t-upper">{selected.label}</h2>
              {local.some((fact) => fact.source === "reference") ? (
                <p className="mb-2 t-small text-ink-2">
                  Declared controls; current bindings are not asserted.
                </p>
              ) : null}
              <Details facts={local} />
            </section>
          </div>
        </div>
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
