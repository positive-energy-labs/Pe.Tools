/**
 * The composer's two chips (agent LEDGER 2026-10-08, protoui round 1 verdict A): the head ladder,
 * provider then model, and the traits the provider offers. Before a thread exists both edit the
 * composer draft, which the first send binds; after, the provider is fixed (fork to change) and
 * model and traits go to the thread.
 */
import { Popover } from "@base-ui/react/popover";
import type { TraitOption } from "@pe/agent-contracts";
import { PopupFrame } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";
import { Switch } from "#/components/lang/switch";
import { Switcher } from "#/components/lang/switcher";
import { Ladder } from "#/route/ladder";
import { useWorkbench } from "#/workbench/provider";
import { isReady, readinessSub } from "#/workbench/provider/providers";

/** A two-way on/off select is a toggle, as a boolean is. */
const isToggle = (trait: TraitOption) =>
  trait.kind === "boolean" ||
  (trait.options.length === 2 && trait.options.every((o) => o.id === "on" || o.id === "off"));
const isOn = (trait: TraitOption) => trait.current === true || trait.current === "on";

/** `high · fast`: each select's current option, then each toggle's word only when on. */
const traitsLabel = (traits: readonly TraitOption[]) =>
  traits
    .map((trait) =>
      isToggle(trait)
        ? isOn(trait)
          ? trait.name.replace(/ mode$/i, "").toLowerCase()
          : ""
        : trait.kind === "select"
          ? (trait.options.find((o) => o.id === trait.current)?.name ?? "").toLowerCase()
          : "",
    )
    .filter(Boolean)
    .join(" · ");

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

/** Chip 1: provider › model. Level 1 refuses a provider that is not ready, and, once a thread is
 * bound, every other provider: a thread never changes provider. */
export function HeadLadder() {
  const head = useHead();
  const fixed = head.bound ? "fork to change" : undefined;
  const modelName = head.modelId
    ? (head.models.find((m) => m.modelId === head.modelId)?.name ?? head.modelId)
    : "default model";
  return (
    <Ladder
      face="inline"
      caution={!head.fallback}
      title="provider › model; the thread binds the provider at its first send"
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
      ]}
    />
  );
}

/** Chip 2: the provider's traits (effort, fast); hidden when it offers none. */
export function TraitsChip() {
  const head = useHead();
  if (head.traits.length === 0) return null;
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Press tone="quiet" size="caption" />}
        title="traits the provider offers for this thread"
      >
        <span className="face-mono">{traitsLabel(head.traits) || "traits"}</span>
      </Popover.Trigger>
      <PopupFrame side="top" align="start" label="traits">
        <div className="grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-2 p-2 t-small">
          {head.traits.map((trait) => (
            <TraitRow key={trait.id} trait={trait} pick={head.pickTrait} />
          ))}
        </div>
      </PopupFrame>
    </Popover.Root>
  );
}

function TraitRow({
  trait,
  pick,
}: {
  trait: TraitOption;
  pick: (id: string, value: string | boolean) => void;
}) {
  return (
    <>
      <span className="text-ink-2">{trait.name}</span>
      {isToggle(trait) ? (
        <Switch
          aria-label={trait.name}
          checked={isOn(trait)}
          onCheckedChange={(on) =>
            pick(trait.id, trait.kind === "boolean" ? on : on ? "on" : "off")
          }
        />
      ) : trait.kind === "select" ? (
        <Switcher
          ariaLabel={trait.name}
          value={trait.current ?? ""}
          onChange={(value) => pick(trait.id, value)}
          options={trait.options.map((o) => ({
            value: o.id,
            label: o.name,
            title: `${trait.name}: ${o.name}`,
          }))}
        />
      ) : null}
    </>
  );
}
