// The asset reel under the composer: every picture, file and model the thread pointed at, oldest
// first (protoui ruling 2026-10-13, agent ledger). Hover previews and lights the message; a press
// on a model `@`s it. What `@` on a capture, image or file means is owed (agent ledger), so those
// tiles carry no mention press: plain `@Name` text would give Pea a name and nothing to read.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Check, Copy, FileText, Image as ImageIcon } from "lucide-react";
import { mentionToken, toolTitle, type Mention } from "@pe/agent-contracts";
import { formatBytes, type ChatMessage } from "@pe/agent-contracts/chat-state";
import { Button } from "@pe/kit/lang/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@pe/kit/lang/tooltip";
import { useCopy } from "@pe/kit/lib/use-copy";
import { pngBlob } from "#/workbench/thumbnail";
import type { ChatDraft } from "#/workbench/prompt";
import { RevitMark } from "./composer-head";

export type ThreadAsset = {
  /** The message that carried it: hover lights it, `#turn` scrolls to it. */
  messageId: string;
  turn: number;
  name: string;
} & (
  | { kind: "capture" | "image"; src: string }
  | { kind: "file"; mimeType: string; size: number; data?: string }
  | { kind: "model"; mention: Mention }
);

const MODEL_KINDS = new Set(["document", "recent"]);

/** The thread's assets in transcript order: a user turn's model mentions and attachments, then
 *  each tool call's captures. */
export function threadAssets(messages: ChatMessage[]): ThreadAsset[] {
  let turn = 0;
  return messages.flatMap((message) => {
    if (message.role === "user") turn += 1;
    const at = { messageId: message.id, turn: Math.max(1, turn) };
    const mentions = (message.mentions ?? [])
      .filter((mention) => MODEL_KINDS.has(mention.kind))
      .map((mention): ThreadAsset => ({ ...at, kind: "model", name: mention.title, mention }));
    const parts = message.parts.flatMap((part): ThreadAsset[] => {
      if (part.type === "image")
        return [{ ...at, kind: "image", name: part.name ?? "image", src: part.image }];
      if (part.type === "file") return [{ ...at, kind: "file", ...part }];
      if (part.type !== "tool-call") return [];
      const { call } = part;
      const name = call.target
        ? (call.target.split(/[\\/]/).at(-1) ?? call.target)
        : toolTitle(call.title);
      return call.images.map((src, index) => ({
        ...at,
        kind: "capture" as const,
        name: call.images.length > 1 ? `${name} ${index + 1}` : name,
        src,
      }));
    });
    return [...mentions, ...parts];
  });
}

/** The draft with a model re-mentioned: the same mention Pea received, joined once. */
export function referModel(draft: ChatDraft, mention: Mention): ChatDraft {
  const gap = draft.text && !draft.text.endsWith(" ") ? " " : "";
  return {
    ...draft,
    text: `${draft.text}${gap}${mentionToken(mention)} `,
    mentions: [...draft.mentions.filter((held) => held.key !== mention.key), mention],
  };
}

const FILTERS = [
  { word: "captures", test: (a: ThreadAsset) => a.kind === "capture" },
  { word: "files", test: (a: ThreadAsset) => a.kind === "image" || a.kind === "file" },
  { word: "model", test: (a: ThreadAsset) => a.kind === "model" },
] as const;

const momentOf = (id: string) =>
  document.querySelector(`[data-annotation="moment"][data-key="${CSS.escape(id)}"]`);

/** Light the message an asset came from while it is hovered. */
function lightMessage(id: string | undefined) {
  for (const lit of document.querySelectorAll("[data-reel-lit]"))
    lit.removeAttribute("data-reel-lit");
  if (id) momentOf(id)?.setAttribute("data-reel-lit", "");
}

export function AssetReel({
  messages,
  onMention,
}: {
  messages: ChatMessage[];
  onMention: (mention: Mention) => void;
}) {
  const assets = useMemo(() => threadAssets(messages), [messages]);
  const [filter, setFilter] = useState<string>();
  useEffect(() => () => lightMessage(undefined), []);
  if (assets.length === 0) return null;
  const shown = assets.filter(FILTERS.find((f) => f.word === filter)?.test ?? (() => true));
  return (
    <div className="dl-asset-reel" role="group" aria-label="Assets in this thread">
      <div className="dl-asset-filters">
        {FILTERS.map((f) => (
          <Button
            key={f.word}
            label={`${assets.filter(f.test).length} ${f.word}`}
            pressed={filter === f.word}
            onClick={() => setFilter(filter === f.word ? undefined : f.word)}
          >
            {assets.filter(f.test).length} {f.word}
          </Button>
        ))}
      </div>
      {/* The filter stack alone sets the reel's height; the tiles fill it. */}
      <div className="relative min-w-0 flex-1">
        <div className="dl-asset-tiles">
          {shown.map((asset, i) => (
            <Fragment key={`${asset.messageId}:${i}`}>
              {shown[i - 1]?.turn !== asset.turn ? (
                <button
                  type="button"
                  className="dl-asset-turn face-mono"
                  onClick={() =>
                    momentOf(asset.messageId)?.scrollIntoView({
                      behavior: "smooth",
                      block: "center",
                    })
                  }
                >
                  #{asset.turn}
                </button>
              ) : null}
              <Tile asset={asset} onMention={onMention} />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function Glyph({ asset, size }: { asset: ThreadAsset; size: number }) {
  if (asset.kind === "model") return <RevitMark width={size} height={size} />;
  if (asset.kind === "file") return <FileText size={size} aria-hidden />;
  return <ImageIcon size={size} aria-hidden />;
}

/** A PDF previews in the browser's own viewer; Chromium draws a blob URL, never a data: one. */
function usePdfUrl(asset: ThreadAsset) {
  const data =
    asset.kind === "file" && asset.mimeType === "application/pdf" ? asset.data : undefined;
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!data) return;
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    const next = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [data]);
  return url;
}

function Tile({ asset, onMention }: { asset: ThreadAsset; onMention: (m: Mention) => void }) {
  const { copied, copy } = useCopy();
  const src = asset.kind === "capture" || asset.kind === "image" ? asset.src : undefined;
  const pdf = usePdfUrl(asset);
  const detail = [
    asset.kind,
    asset.kind === "capture" ? "Pea captured" : "you added",
    `#${asset.turn}`,
    asset.kind === "file" ? formatBytes(asset.size) : undefined,
    asset.kind === "model" ? "press to @ it" : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span className="relative flex shrink-0">
      {/* The kit tooltip owns hover and focus timing (N7); its open state lights the message. */}
      <Tooltip onOpenChange={(open) => lightMessage(open ? asset.messageId : undefined)}>
        <TooltipTrigger
          render={<button type="button" />}
          aria-label={asset.kind === "model" ? `Mention ${asset.name}` : asset.name}
          className="dl-asset-tile"
          data-from={asset.kind === "capture" ? "pea" : "you"}
          onClick={asset.kind === "model" ? () => onMention(asset.mention) : undefined}
        >
          {src ? (
            <img src={src} alt={asset.name} />
          ) : (
            <span className="dl-asset-glyph">
              <Glyph asset={asset} size={20} />
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="top">
          <div className="flex w-[280px] flex-col gap-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <Glyph asset={asset} size={14} />
              <span className="truncate font-semibold">{asset.name}</span>
            </div>
            {src ? <img src={src} alt="" className="max-h-40 w-full object-contain" /> : null}
            {pdf ? (
              <object
                data={`${pdf}#toolbar=0&view=FitH`}
                type="application/pdf"
                className="h-40 w-full"
              >
                {asset.name}
              </object>
            ) : null}
            <span className="text-ink-2">{detail}</span>
          </div>
        </TooltipContent>
      </Tooltip>
      <span className="dl-corner-copy">
        <Button
          label={copied ? "Copied" : src ? "Copy image" : "Copy name"}
          icon={copied ? <Check size={12} /> : <Copy size={12} />}
          onClick={() => copy(src ? pngBlob(src) : asset.name)}
        />
      </span>
    </span>
  );
}
