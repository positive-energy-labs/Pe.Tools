import { useEffect, useMemo, useState } from "react";

import { Section } from "#/components/lang/section";
import { Gap } from "#/design-system/exhibit";

interface TokenSpec {
  token: string;
  means: string;
  /** How the two sibling renderings differ â€” this is the pairing table's payload, in one line. */
  modes: string;
}

const TOKEN_GROUPS: readonly { group: string; asks: string; tokens: readonly TokenSpec[] }[] = [
  {
    group: "grounds",
    asks: "what surface is this sitting on?",
    tokens: [
      {
        token: "--pe-page",
        means: "the page itself; prose and page chrome",
        modes: "L .985 â†” .185 â€” one hue (88Â°) in both modes",
      },
      {
        token: "--pe-artifact",
        means: "the machine-operated object: table, card, strip",
        modes: "one lightness step off the page, both modes",
      },
      {
        token: "--pe-recess",
        means: "set INTO an artifact: head/foot bands, the key",
        modes: "same step size again â€” the ladder is even",
      },
      {
        token: "--pe-select",
        means: "selection + focus fill. never a hue",
        modes: "rung 4; the no-hue law made structural",
      },
    ],
  },
  {
    group: "inks",
    asks: "how loud is this text allowed to be?",
    tokens: [
      {
        token: "--pe-ink",
        means: "primary text: values, labels, prose",
        modes: "inverted pair on the ground's own hue",
      },
      {
        token: "--pe-ink-2",
        means: "annotations, footlines, captions, counts",
        modes: "light value sits AT the meaning band's lightness",
      },
      {
        token: "--pe-ink-mute",
        means: "locked Â· dropped Â· the 'never checked' squiggle",
        modes: "near-achromatic; ~0 drift and ~0 Î”L across modes",
      },
    ],
  },
  {
    group: "hairlines",
    asks: "is this a seam, or a box?",
    tokens: [
      {
        token: "--pe-line",
        means: "quiet: row rules, the artifact frame's inset edge",
        modes: "ink @12% â†” @14% â€” derived, so it rides the hue free",
      },
      {
        token: "--pe-line-2",
        means: "firm: seams, citation underline, chip edge, focus",
        modes: "ink @22% â†” @26%",
      },
    ],
  },
  {
    group: "meanings",
    asks: "what fact is this hue standing for?",
    tokens: [
      {
        token: "--pe-pea",
        means: "pea's MARK: proposal ring, corner fold, card edge",
        modes: "the display rung â€” band lightness stepped 0.08 toward its ground",
      },
      {
        token: "--pe-pea-ink",
        means: "pea at ink weight: pea's text, the wash source",
        modes: "on-band, both modes; h158 unmoved",
      },
      {
        token: "--pe-alarm",
        means: "THE one alarm: drift, refusal, the ghost value",
        modes: "the one legislated off-band token (+35% chroma), both modes",
      },
      {
        token: "--pe-caution",
        means: "stale Â· unverified Â· unsaved Â· partial Â· error",
        modes: "on-band; 2.8Ã— the incumbent kiln's chroma",
      },
      {
        token: "--pe-done",
        means: "it landed: receipts, the post-commit sentence",
        modes: "on-band; 25Â° from pea â€” adjacent, not equal",
      },
      {
        token: "--pe-commit",
        means: "the only filled blue: writes beyond the page",
        modes: "PE blue's exact hue, band-quantized",
      },
      {
        token: "--pe-on-commit",
        means: "text/icon sitting on a commit fill",
        modes: "= --pe-page. no pure white or black exists in the set",
      },
      {
        token: "--pe-nav",
        means: "nav as blue TEXT â€” back Â· forward Â· out",
        modes: "byte-identical to commit; the job carries the difference",
      },
    ],
  },
  {
    group: "viz",
    asks: "which series is this? (kind, never state)",
    tokens: [
      {
        token: "--viz-1",
        means: "series 1 â€” carries the old cat-blue identity",
        modes: "band-quantized: L .470 â†” .795, hue unmoved",
      },
      {
        token: "--viz-2",
        means: "series 2 â€” old cat-green",
        modes: "same band; no series out-shouts another",
      },
      {
        token: "--viz-3",
        means: "series 3 â€” old cat-slate (low chroma)",
        modes: "C .045 keeps its near-neutral character",
      },
      { token: "--viz-4", means: "series 4 â€” old cat-lichen", modes: "on-band" },
      {
        token: "--viz-5",
        means: "series 5 â€” old cat-clay",
        modes: "on-band; a chart clay is not the alarm",
      },
      {
        token: "--viz-6",
        means: "series 6 â€” old cat-kiln (low chroma)",
        modes:
          "C .055. THE GRAYSCALE LAW: a viz spend must survive grayscale â€” label, legend, or position carries the distinction",
      },
    ],
  },
];

/** Read the live values off :root, and re-read when the theme class flips. The page reports the
 *  contract rather than restating it â€” re-pitching a token shows up here untouched. */
function useTokenValues(tokens: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      setValues(Object.fromEntries(tokens.map((t) => [t, style.getPropertyValue(t).trim()])));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
    // token list is a module constant; re-reading on theme flips is the only dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return values;
}

export function TokenSpecimens() {
  const all = useMemo(() => TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.token)), []);
  const values = useTokenValues(all);

  return (
    <Section label="02 Â· tokens">
      <p>
        eighteen, and every one of them is oklch(L C h) off a declared band â€” src/base.css is the
        one place a colour is decided
      </p>
      <p className="max-w-[80ch]">
        <code>--pe-*</code> is canon. The old <code>--act-*</code> / <code>--st-*</code> /{" "}
        <code>--cat-*</code> role vocabulary in <code>styles.css</code> is retired and removed. The
        repo guard rejects its reintroduction; <code>--pe-*</code> is the sole authority. Swatches
        below are read off <code>:root</code> at render and re-read when you flip the theme â€” this
        table cannot drift from the stylesheet.
      </p>

      {TOKEN_GROUPS.map((g) => (
        <div key={g.group} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-3 pb-1">
            <span>{g.group}</span>
            <span>{g.asks}</span>
          </div>
          {g.tokens.map((t) => (
            <div
              key={t.token}
              className="grid grid-cols-[2.25rem_minmax(0,10rem)_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-1 sm:grid-cols-[2.25rem_minmax(0,10rem)_minmax(0,1fr)_minmax(0,20rem)]"
            >
              <span
                className="h-5 w-9"
                style={{ backgroundColor: `var(${t.token})` }}
                title={values[t.token] ?? t.token}
              />
              <span>{t.token}</span>
              <span className="min-w-0">{t.means}</span>
              <span className="col-span-3 sm:col-span-1">{t.modes}</span>
            </div>
          ))}
        </div>
      ))}

      <Gap>
        the swatch reads a resolved value for every token except the two hairlines, which are
        declared as <code>color-mix()</code> and read back unresolved. Nothing is wrong with the
        colour; the ledger of computed contrast lives in the header of <code>src/base.css</code>{" "}
        because no component can compute it.
      </Gap>
    </Section>
  );
}

/* â•â•â• 04 Â· the catalogue â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
