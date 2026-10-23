import { SvgTip } from "@pe/kit/lang/tooltip";
/**
 * Who runs a thread, as a monochrome glyph in currentColor sized to the text (1em); it never mints
 * a hue. Unknown harnesses wear the pea fallback and the label still says which.
 */
import type { SVGProps } from "react";

/** The harness ids the host speaks (`harnessIds` in agent-contracts) plus Pea's own. */
export type ProviderKey = "claude" | "codex" | "pea";

const ANTHROPIC =
  "M17.304 3.541h-3.672l6.696 16.918H24Zm-10.608 0L0 20.459h3.744l1.37-3.553h7.005l1.369 3.553h3.744L10.536 3.541Zm-.371 10.223 2.291-5.946 2.292 5.946Z";

const OPENAI =
  "M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .511 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.748-7.073ZM13.26 22.43a4.476 4.476 0 0 1-2.876-1.041l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.169a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494ZM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646ZM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.677l5.815 3.354-2.02 1.169a.076.076 0 0 1-.071 0l-4.83-2.787A4.504 4.504 0 0 1 2.34 7.872Zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667Zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66Zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681Zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z";

/** Which glyph a harness id wears. Unknown ids fall back to Pea's. */
function providerOf(harness: string | null | undefined): ProviderKey {
  return harness === "claude" || harness === "codex" ? harness : "pea";
}

const NAME: Record<ProviderKey, string> = {
  claude: "Claude Code (Anthropic)",
  codex: "Codex (OpenAI)",
  pea: "Pea",
};

export function ProviderMark({
  harness,
  ...props
}: {
  /** A harness id (`claude`, `codex`) or anything else, which draws the fallback. */
  harness: string | null | undefined;
} & Omit<SVGProps<SVGSVGElement>, "viewBox" | "children" | "className">) {
  const key = providerOf(harness);
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      role="img"
      aria-label={NAME[key]}
      data-provider={key}
      className="inline-block shrink-0 align-[-0.125em]"
      {...props}
    >
      <SvgTip content={key} />
      {key === "claude" ? (
        <path d={ANTHROPIC} />
      ) : key === "codex" ? (
        <path d={OPENAI} />
      ) : (
        // Pea: one round pea, a hairline pod under it.
        <>
          <circle cx="12" cy="11" r="6" />
          <path
            d="M3 17.5c3 2.4 15 2.4 18 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}
