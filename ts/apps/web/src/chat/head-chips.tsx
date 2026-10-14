/** The composer's ladder: provider › model › one rung per provider trait (effort, fast). Before a
 *  thread exists every rung edits the draft, which the first send binds; after, the provider is
 *  fixed (fork to change) and the model and traits go to the thread. */
import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { useDestination } from "#/navigation/state";
import { settingsDestination } from "#/machine/navigation";
import type { TraitOption } from "@pe/agent-contracts";
import { Ladder, type Rung } from "#/route/ladder";
import { ProviderMark } from "#/components/lang/provider-mark";
import { useWorkbench } from "#/workbench/provider";
import { isReady, readinessSub, repairWord } from "#/workbench/provider/providers";
import type { GrantView } from "./scope";

/** A two-way on/off select is a toggle, as a boolean is. */
const isToggle = (trait: TraitOption) =>
  trait.kind === "boolean" ||
  (trait.options.length === 2 && trait.options.every((o) => o.id === "on" || o.id === "off"));
const isOn = (trait: TraitOption) => trait.current === true || trait.current === "on";

/** One rung for a trait: a select's options, or a toggle's two words (`fast` / `not fast`). */
function traitRung(trait: TraitOption, pick: (id: string, value: string | boolean) => void): Rung {
  const word = trait.name.replace(/ mode$/i, "").toLowerCase();
  if (isToggle(trait))
    return {
      key: trait.id,
      label: isOn(trait) ? word : `not ${word}`,
      silent: !isOn(trait),
      placeholder: `choose ${word}`,
      options: [
        { id: "on", label: word },
        { id: "off", label: `not ${word}` },
      ],
      picked: (id) => (id === "on") === isOn(trait),
      pick: (id) => pick(trait.id, trait.kind === "boolean" ? id === "on" : id),
    };
  const options = trait.kind === "select" ? trait.options : [];
  return {
    key: trait.id,
    label: (options.find((o) => o.id === trait.current)?.name ?? `default ${word}`).toLowerCase(),
    placeholder: `choose ${word}`,
    options: options.map((o) => ({ id: o.id, label: o.name })),
    picked: (id) => id === trait.current,
    pick: (id) => pick(trait.id, id),
  };
}

/** The head in force: the thread's when one is open, else the draft's. */
function useHead() {
  const { chat, currentThreadId, threads, providers, draft, setDraft, setModel, setTrait } =
    useWorkbench();
  const list = providers.list ?? [];
  const fallback = list.find(isReady) ?? null;
  if (currentThreadId) {
    const summary = threads.find((item) => item.id === currentThreadId);
    const providerId = chat.providerId || summary?.providerId;
    return {
      bound: providerId ?? null,
      picked: providerId ?? draft.providerId ?? DEFAULT,
      list,
      fallback,
      providerName: chat.providerName || summary?.providerName || "provider",
      harness: list.find((item) => item.id === providerId)?.harness ?? null,
      models: chat.models,
      modelId: chat.modelId ?? summary?.modelId ?? null,
      traits: chat.traits,
      pickProvider: () => {},
      pickModel: (id: string) => void setModel(id),
      pickTrait: (id: string, value: string | boolean) => void setTrait(id, value),
    };
  }
  const provider = draft.providerId ? list.find((item) => item.id === draft.providerId) : fallback;
  return {
    bound: null,
    picked: draft.providerId ?? DEFAULT,
    list,
    fallback,
    providerName: draft.providerId ? (provider?.name ?? draft.providerId) : "Pea default",
    harness: provider?.harness ?? null,
    models: provider?.models ?? [],
    modelId: draft.modelId,
    traits: (provider?.traits ?? []).map(
      (trait) => ({ ...trait, current: draft.traits[trait.id] ?? trait.current }) as TraitOption,
    ),
    pickProvider: (id: string) =>
      setDraft({ providerId: id === DEFAULT ? null : id, modelId: null, traits: {} }),
    pickModel: (id: string) => setDraft({ ...draft, modelId: id }),
    pickTrait: (id: string, value: string | boolean) =>
      setDraft({ ...draft, traits: { ...draft.traits, [id]: value } }),
  };
}

const DEFAULT = "pea-default";

/** provider › model › traits. Rung 1 refuses a provider that is not ready, and, once a thread is
 * bound, every other provider: a thread never changes provider. */
export function HeadLadder() {
  const go = useDestination();
  const head = useHead();
  const [open, setOpen] = useState(false);
  const { providers } = useWorkbench();
  // The picker is where a missing harness is noticed, so it carries the one press that repairs it.
  const manage = (
    <>
      {head.list.map((provider) => {
        const word = !isReady(provider) && repairWord(provider);
        return word ? (
          <Button
            key={provider.id}
            label={`${word} ${provider.name}`}
            onClick={() => void providers.openLogin(provider.id)}
          >
            {`${word} ${provider.name}`}
          </Button>
        ) : null;
      })}
      <Button
        label="Manage providers"
        onClick={() => {
          setOpen(false);
          go(settingsDestination("providers"));
        }}
      >
        Manage providers
      </Button>
    </>
  );
  const fixed = head.bound ? "fork to change" : undefined;
  const modelName = head.modelId
    ? (head.models.find((m) => m.modelId === head.modelId)?.name ?? head.modelId)
    : "default model";
  return (
    <Ladder
      face="control"
      open={open}
      onOpenChange={setOpen}
      // Open on the model; the first trait (effort) ends the walk, or the model when there is none.
      openOn="model"
      closeOn={[head.traits[0]?.id ?? "model"]}
      // Who runs it, as its maker's mark before the model (kaitpw, 2026-10-12).
      mark={<ProviderMark harness={head.harness} />}
      caution={!head.fallback}
      title="provider › model › traits; the thread binds the provider at its first send"
      levels={[
        {
          key: "provider",
          extra: manage,
          label: head.providerName,
          placeholder: "choose a provider",
          options: [
            {
              id: DEFAULT,
              label: "Pea default",
              sub: head.fallback ? `→ ${head.fallback.name}` : "○ no provider is ready",
              caution: !head.fallback,
              refusal: fixed ?? (head.fallback ? undefined : "not ready"),
            },
            ...head.list.map((provider) => ({
              id: provider.id,
              label: provider.name,
              sub: readinessSub(provider),
              caution: !isReady(provider),
              refusal:
                provider.id === head.bound
                  ? undefined
                  : (fixed ?? (isReady(provider) ? undefined : "not ready")),
            })),
          ],
          picked: (id) => id === head.picked,
          pick: head.pickProvider,
        },
        {
          key: "model",
          extra: manage,
          label: modelName,
          placeholder: "choose a model",
          options: head.models.length
            ? head.models.map((m) => ({ id: m.modelId, label: m.name }))
            : null,
          note: "this provider lists no models; use Manage providers to probe it",
          picked: (id) => id === head.modelId,
          pick: head.pickModel,
        },
        ...head.traits.map((trait) => traitRung(trait, head.pickTrait)),
      ]}
    />
  );
}

/**
 * Whether Pea may write the document this thread points at, counted on the host's clock. Words
 * only, no button: pointing the thread elsewhere ends the grant, and the next message you send
 * renews it. Nothing when the thread holds no grant (no document, a named target, Pea's own).
 * The copy is lowercase by ruling (`rw · 42m`), so the chip takes no sentence casing.
 */
export function GrantChip({ grant }: { grant: GrantView | null }) {
  if (!grant) return null;
  const [tone, text, title] =
    grant.state === "rw"
      ? [
          "done",
          `rw · ${grant.minutes}m`,
          "Pea may write this document. Each message you send renews it to 60 minutes; pointing the thread elsewhere ends it.",
        ]
      : grant.state === "expired"
        ? [
            "caution",
            "read · renews on your next message",
            "Pea can read this document but not write it. Your next message in this thread renews rw.",
          ]
        : [
            "alarm",
            "revoked · point the thread at it again to grant",
            "rw on this document was revoked. Steps already running finish; nothing new starts until you point the thread at the document again.",
          ];
  return (
    <span className="face-mono" data-tone={tone} data-testid="grant-chip" title={title}>
      {text}
    </span>
  );
}
