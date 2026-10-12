// The draft's attachments, headless: admit (size and count limits), read (text or base64), drag.
// Wire `fileInputProps` to a hidden input, `dropProps` to the drop box, `pasteHandler` to the field.
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";
import type { PromptAttachment } from "@pe/agent-contracts";
import type { ChatDraft } from "#/workbench/prompt";

// ponytail: our own ceiling, 5 MB a file and 10 a message; the model provider's limit is the real
// authority. Raise these when a provider accepts more and users hit them.
export const ATTACHMENT_LIMITS = { fileBytes: 5 * 1024 * 1024, files: 10 };

/** The one attachment rule: which files fit beside `held` ones, and one line naming the rest. */
export function admitFiles(files: File[], held: number): { admitted: File[]; refusal?: string } {
  const admitted: File[] = [];
  const tooBig: string[] = [];
  const tooMany: string[] = [];
  for (const file of files) {
    if (file.size > ATTACHMENT_LIMITS.fileBytes) tooBig.push(file.name);
    else if (held + admitted.length >= ATTACHMENT_LIMITS.files) tooMany.push(file.name);
    else admitted.push(file);
  }
  const reasons = [
    tooBig.length
      ? `${tooBig.join(", ")} (over the ${ATTACHMENT_LIMITS.fileBytes / 1024 / 1024} MB limit per file)`
      : "",
    tooMany.length
      ? `${tooMany.join(", ")} (${ATTACHMENT_LIMITS.files} files per message at most)`
      : "",
  ].filter(Boolean);
  return { admitted, refusal: reasons.length ? `Not added: ${reasons.join("; ")}` : undefined };
}

export async function readAttachment(file: File): Promise<PromptAttachment> {
  const textual =
    file.type.startsWith("text/") ||
    /\.(md|txt|json|jsonc|csv|tsv|ts|tsx|js|jsx|cs|py|rb|go|rs|java|yaml|yml|toml|xml|html|css)$/i.test(
      file.name,
    );
  if (textual) {
    return {
      name: file.name,
      mimeType: file.type || "text/plain",
      size: file.size,
      text: await file.text(),
    };
  }
  return {
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    data: base64FromBuffer(await file.arrayBuffer()),
  };
}

export function base64FromBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const carriesFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

export function useAttachments(draft: ChatDraft, setDraft: Dispatch<SetStateAction<ChatDraft>>) {
  const { attachments } = draft;
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [refusal, setRefusal] = useState<string>();

  const add = async (list: ArrayLike<File>) => {
    const { admitted, refusal } = admitFiles(Array.from(list), attachments.length);
    setRefusal(refusal);
    if (admitted.length === 0) return;
    const next = await Promise.all(admitted.map(readAttachment));
    setDraft((previous) => ({ ...previous, attachments: [...previous.attachments, ...next] }));
  };
  const remove = (index: number) =>
    setDraft((previous) => ({
      ...previous,
      attachments: previous.attachments.filter((_, position) => position !== index),
    }));

  // A file dropped anywhere else must not navigate the tab to it.
  useEffect(() => {
    const guard = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  const onDragOver = (event: DragEvent) => {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    setDragging(true);
  };

  return {
    attachments,
    add,
    remove,
    refusal,
    dragging,
    /** Opens the file picker behind `fileInputProps`. */
    browse: () => input.current?.click(),
    fileInputProps: {
      ref: input,
      type: "file" as const,
      multiple: true,
      hidden: true,
      onChange: (event: { currentTarget: HTMLInputElement }) => {
        const target = event.currentTarget;
        if (!target.files?.length) return;
        void add(target.files).then(() => {
          target.value = "";
        });
      },
    },
    dropProps: {
      onDragEnter: onDragOver,
      onDragOver,
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      },
      onDrop: (event: DragEvent) => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        setDragging(false);
        void add(event.dataTransfer.files);
      },
    },
    pasteHandler: (event: ClipboardEvent) => {
      const files = event.clipboardData.files;
      if (files.length === 0) return;
      event.preventDefault();
      void add(files);
    },
  };
}
