import { useEffect, useRef, useState } from "react";

/** Copy text, or an image as a PNG blob, and flip a "copied" flag for 1.5 s once the clipboard
 *  accepted it; a refused write leaves the flag down. The one copy behavior: `Code`, chat
 *  messages, and chat images. */
export function useCopy(): { copied: boolean; copy: (value: string | Promise<Blob>) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = (value: string | Promise<Blob>) => {
    (typeof value === "string"
      ? navigator.clipboard.writeText(value)
      : navigator.clipboard.write([new ClipboardItem({ "image/png": value })])
    ).then(
      () => {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  };
  return { copied, copy };
}
