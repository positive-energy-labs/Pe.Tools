/** The composer's ladder: provider › model › one rung per provider trait (effort, fast). Before a
 *  thread exists every rung edits the draft, which the first send binds; after, the provider is
 *  fixed (fork to change) and the model and traits go to the thread. */
import type { TraitOption } from "@pe/agent-contracts";
import { Ladder, type Rung } from "#/route/ladder";
import { ProviderMark } from "#/components/lang/provider-mark";
import { useWorkbench } from "#/workbench/provider";
import { isReady, readinessSub } from "#/workbench/provider/providers";

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
  const head = useHead();
  const fixed = head.bound ? "fork to change" : undefined;
  const modelName = head.modelId
    ? (head.models.find((m) => m.modelId === head.modelId)?.name ?? head.modelId)
    : "default model";
  return (
    <Ladder
      face="control"
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
          label: modelName,
          placeholder: "choose a model",
          options: head.models.length
            ? head.models.map((m) => ({ id: m.modelId, label: m.name }))
            : null,
          note: "this provider lists no models; probe it in Settings",
          picked: (id) => id === head.modelId,
          pick: head.pickModel,
        },
        ...head.traits.map((trait) => traitRung(trait, head.pickTrait)),
      ]}
    />
  );
}
