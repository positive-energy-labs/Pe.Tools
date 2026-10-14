// One attached file in the composer: thumbnail for images, size for the rest, a PDF opens.
import { FileChip } from "@pe/kit/lang/chip";
import { Thumbnail } from "#/workbench/thumbnail";
import { formatBytes } from "#/workbench/chat-state";
import { isPdf, openPdf } from "#/workbench/open-pdf";
import type { PromptAttachment } from "@pe/agent-contracts";

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PromptAttachment;
  onRemove: () => void;
}) {
  const { name, mimeType, data, size } = attachment;
  const image = !!data && mimeType.startsWith("image/");
  return (
    <FileChip
      name={name}
      meta={image ? undefined : formatBytes(size)}
      title={`${name} is attached to the next message`}
      lead={
        image ? (
          <Thumbnail src={`data:${mimeType};base64,${data}`} name={name} fit="chip" />
        ) : undefined
      }
      open={isPdf(mimeType, data) ? () => openPdf(data) : undefined}
      onRemove={onRemove}
    />
  );
}
