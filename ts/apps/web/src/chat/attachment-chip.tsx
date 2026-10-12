// One attached file as a chip: thumbnail for images, size for the rest, a remove button.
import { X } from "lucide-react";
import { chipRecipe } from "#/components/lang/chip";
import { Button } from "#/components/lang/button";
import { Thumbnail } from "#/workbench/thumbnail";
import { formatBytes } from "#/workbench/chat-state";
import type { PromptAttachment } from "@pe/agent-contracts";

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PromptAttachment;
  onRemove: () => void;
}) {
  const { base, label, count } = chipRecipe();
  const name = attachment.name;
  const image = !!attachment.data && attachment.mimeType.startsWith("image/");
  return (
    <span
      className={base({ class: image ? "h-auto py-[3px]" : undefined })}
      data-surface="artifact"
      title={`${name} is attached to the next message`}
    >
      {image ? (
        <Thumbnail
          src={`data:${attachment.mimeType};base64,${attachment.data}`}
          name={name}
          fit="chip"
        />
      ) : null}
      <span className={label()}>{name}</span>
      {!image ? <span className={count()}>{formatBytes(attachment.size)}</span> : null}
      <Button icon={X} label={`Remove ${name}`} onClick={onRemove} />
    </span>
  );
}
