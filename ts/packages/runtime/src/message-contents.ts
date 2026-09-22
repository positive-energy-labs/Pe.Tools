type MessageFile = { data: string; mediaType: string; filename?: string };

/** Mirrors core `Session.createMessageInput` (private there): text and JSON files inline as fenced text. */
export function messageContents(content: string, files: MessageFile[] | undefined) {
  if (!files?.length) return content;
  const fileParts = files.map((file) => {
    if (file.mediaType.startsWith("text/") || file.mediaType === "application/json") {
      const base64 = /^data:[^;]*;base64,(.*)$/.exec(file.data)?.[1];
      const text = base64 ? Buffer.from(base64, "base64").toString("utf-8") : file.data;
      const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      const label = file.filename ? `[File: ${file.filename}]` : "[Attached file]";
      return {
        type: "text" as const,
        text: `${label}
${fence}
${text}
${fence}`,
      };
    }
    return {
      type: "file" as const,
      data: file.data,
      mediaType: file.mediaType,
      ...(file.filename ? { filename: file.filename } : {}),
    };
  });
  return content ? [{ type: "text" as const, text: content }, ...fileParts] : fileParts;
}
