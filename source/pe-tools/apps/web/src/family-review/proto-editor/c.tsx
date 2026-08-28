import { token } from "#/lib/token";
/**
 * PROTOTYPE (round 2 · piece 3) — PARADIGM C · SENTENCE BUILDER.
 *
 * THE CLAIM: every authored construct is one structured sentence, and every token in it is a typed
 * picker scoped to what is legal THERE — parameters of the right dataType, frames in scope, planes
 * and faces that exist. You read the document as prose and you edit it by replacing a word. The
 * relations are not in a side panel: `on frame:supply-air` is in the sentence, so a solid's anchor
 * is a thing you read rather than a thing you go looking for.
 *
 * THE SENTENCE GROWS AS IT BINDS. Author a new solid and it starts as "— pick — <slug> on — pick —"
 * with nothing else: until the KIND is bound, the surface does not know whether the sentence wants
 * width/depth/height or diameter/height, and it declines to guess. That is the from-scratch case
 * the round is really about, and it is the one thing a generated form gets structurally wrong — a
 * form renders every optional field of the union at once and lets you fill in an illegal
 * combination.
 *
 * FORK, DECLARED. `components/sentence.tsx` is the app's clickable-noun grammar and it does NOT
 * fit: `Sentence` is a TARGETING surface (document · profile · world clause) wired to `useFleet`
 * and `resolveTarget`, its `Slot`/`Popover` are module-private, and its law says the sentence
 * carries targeting nouns ONLY. This is a different sentence — a DOMAIN sentence about one
 * construct. The reusable middle (a token whose picker is scoped to what is legal here) is
 * `RefToken` in `shell.tsx`; if C wins, extracting that into `components/lang` is the promotion
 * work, and `sentence.tsx` should then be built on it rather than beside it.
 */
import { useState } from "react";

import { Verb } from "#/components/lang/verb";
import { addSolid, nodeValue, setField, setStub } from "#/family-review/proto-editor/model";
import { RefToken, TextToken, type Editor } from "#/family-review/proto-editor/shell";
import {
  setParamFormula,
  setParamValue,
  setOverride,
  type FamilyModel,
} from "#/family/family-model";

export function ParadigmC({ editor }: { editor: Editor }) {
  const [draft, setDraft] = useState("");
  const model = editor.model;
  const write = (fn: (model: FamilyModel) => FamilyModel) => editor.apply(fn);

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
      <p className="t-caption mb-3 max-w-[720px] text-ink-2">
        Every line below is one authored construct. Underlined words are tokens: click one and the
        picker offers only what is legal in that slot, read out of this document. Amber means
        unbound.
      </p>

      <Group label="parameters">
        {Object.entries(model.familyParameters).map(([name, spec]) => (
          <Line key={name} lead="param">
            <b className="face-mono t-label text-ink">{name}</b>
            <Word>is a</Word>
            <span className="face-mono t-label text-ink-2">{spec.dataType}</span>
            <Word>parameter</Word>
            {spec.formula != null ? (
              <>
                <Word>computed as</Word>
                <TextToken
                  value={spec.formula}
                  width={200}
                  title={`Rewrite ${name}'s formula. A parameter carries a value XOR a formula; the host enforces it.`}
                  onCommit={(text) => write((next) => setParamFormula(next, name, text))}
                />
              </>
            ) : (
              <>
                <Word>worth</Word>
                <TextToken
                  value={spec.value ?? ""}
                  width={80}
                  title={`Write ${name}'s family value — a portable literal (24in, 2 1/2in, 600mm)`}
                  onCommit={(text) => write((next) => setParamValue(next, name, text))}
                />
              </>
            )}
            {Object.entries(model.types)
              .filter(([, overrides]) => overrides[name] != null)
              .map(([typeName, overrides]) => (
                <span key={typeName} className="flex items-baseline gap-1">
                  <Word>·</Word>
                  <span className="t-caption text-ink-mute">{typeName} overrides to</span>
                  <TextToken
                    value={overrides[name] ?? ""}
                    width={64}
                    title={`Write the ${typeName} override for ${name}`}
                    onCommit={(text) =>
                      write((next) => setOverride(next, typeName, name, text || null))
                    }
                  />
                </span>
              ))}
          </Line>
        ))}
      </Group>

      <Group label="planes">
        {Object.entries(model.planes ?? {}).map(([slug, plane]) => (
          <Line key={slug} lead="plane">
            <b className="face-mono t-label text-ink">{slug}</b>
            <Word>sits</Word>
            <RefToken
              editor={editor}
              value={plane.by}
              kind="lengthParam"
              title="The length this plane is offset by — only Length parameters are legal here"
              onPick={(ref) => write((next) => setField(next, "planes", slug, "by", ref))}
            />
            <Resolved editor={editor} token={plane.by} />
            <RefToken
              editor={editor}
              value={plane.direction}
              kind="direction"
              title="Which way the offset travels from the plane it hangs off"
              onPick={(ref) => write((next) => setField(next, "planes", slug, "direction", ref))}
            />
            <Word>of</Word>
            <RefToken
              editor={editor}
              value={plane.from}
              kind="plane"
              title="The plane this one hangs off — stock family planes and every plane already authored"
              onPick={(ref) => write((next) => setField(next, "planes", slug, "from", ref))}
            />
          </Line>
        ))}
      </Group>

      <Group label="frames">
        {Object.entries(model.frames ?? {}).map(([slug, frame]) => (
          <Line key={slug} lead="frame">
            <b className="face-mono t-label text-ink">{slug}</b>
            <Word>sits where</Word>
            {frame.origin.map((ref, index) => (
              <span key={`${slug}-${index}`} className="flex items-baseline gap-1">
                <RefToken
                  editor={editor}
                  value={ref}
                  kind="anchor"
                  title="One of the three surfaces whose intersection is this frame's origin — faces of authored solids and every plane in scope"
                  onPick={(target) =>
                    write((next) => ({
                      ...next,
                      frames: {
                        ...next.frames,
                        [slug]: {
                          ...frame,
                          origin: frame.origin.map((entry, at) => (at === index ? target : entry)),
                        },
                      },
                    }))
                  }
                />
                {index < frame.origin.length - 1 ? <Word>×</Word> : null}
              </span>
            ))}
            <Word>, facing</Word>
            <RefToken
              editor={editor}
              value={frame.normal}
              kind="axis"
              title="The frame's normal — one named axis; oblique orientation is unmodeled forever"
              onPick={(ref) => write((next) => setField(next, "frames", slug, "normal", ref))}
            />
            <Word>with up</Word>
            <RefToken
              editor={editor}
              value={frame.up}
              kind="axis"
              title="The frame's up axis"
              onPick={(ref) => write((next) => setField(next, "frames", slug, "up", ref))}
            />
          </Line>
        ))}
      </Group>

      <Group label="solids">
        {Object.entries(model.solids ?? {}).map(([slug, solid]) => {
          const round = solid.kind.endsWith("Cylinder");
          const dims =
            solid.kind === "" ? [] : round ? ["diameter", "height"] : ["width", "depth", "height"];
          return (
            <Line key={slug} lead={solid.kind.startsWith("Void") ? "void" : "solid"}>
              <RefToken
                editor={editor}
                value={solid.kind}
                kind="solidKind"
                title="The solid vocabulary ceiling — Prism, Cylinder and their voids. Sweeps and blends are unmodeled forever."
                onPick={(ref) => write((next) => setField(next, "solids", slug, "kind", ref))}
              />
              <b className="face-mono t-label text-ink">{slug}</b>
              <Word>on</Word>
              <RefToken
                editor={editor}
                value={solid.frame}
                kind="frame"
                title="The frame this solid is built in. frame:family means the family origin, unrotated."
                onPick={(ref) => write((next) => setField(next, "solids", slug, "frame", ref))}
              />
              {dims.length === 0 ? (
                <span className="t-caption text-caution">
                  — pick a kind and the sentence will ask for the dimensions it needs
                </span>
              ) : null}
              {dims.map((field) => (
                <span key={field} className="flex items-baseline gap-1">
                  <Word>, {field}</Word>
                  <RefToken
                    editor={editor}
                    value={solid[field as "width"] ?? ""}
                    kind="lengthParam"
                    title={`The parameter driving this solid's ${field}. Numbers live on parameters, never here.`}
                    onPick={(ref) => write((next) => setField(next, "solids", slug, field, ref))}
                  />
                  <Resolved editor={editor} token={solid[field as "width"]} />
                </span>
              ))}
            </Line>
          );
        })}

        <div className="mt-2 flex items-baseline gap-2">
          <TextToken
            value={draft}
            width={120}
            title="Name for a new solid — the slug the document will carry"
            onCommit={setDraft}
          />
          <Verb
            label="author solid"
            reason={
              draft === ""
                ? "Name it first — the slug is how every other sentence will refer to it"
                : model.solids?.[draft] != null
                  ? `A solid called ${draft} already exists`
                  : `Add an unbound solid sentence called ${draft}; nothing is guessed for you`
            }
            disabled={draft === "" || model.solids?.[draft] != null}
            onClick={() => {
              write((next) => addSolid(next, draft));
              setDraft("");
            }}
          />
        </div>
      </Group>

      <Group label="connectors">
        {Object.entries(model.connectors ?? {}).map(([slug, connector]) => {
          const dims = connector.shape === "Round" ? ["diameter"] : ["width", "height"];
          return (
            <Line key={slug} lead={connector.domain.toLowerCase()}>
              <b className="face-mono t-label text-ink">{slug}</b>
              <Word>
                is a {connector.shape.toLowerCase()} {connector.domain.toLowerCase()} connector on
              </Word>
              <RefToken
                editor={editor}
                value={connector.frame}
                kind="frame"
                title="The frame that places and orients this connector"
                onPick={(ref) => write((next) => setField(next, "connectors", slug, "frame", ref))}
              />
              {dims.map((field) => (
                <span key={field} className="flex items-baseline gap-1">
                  <Word>, {field}</Word>
                  <RefToken
                    editor={editor}
                    value={connector[field as "width"] ?? ""}
                    kind="lengthParam"
                    title={`The parameter driving this connector's ${field}`}
                    onPick={(ref) =>
                      write((next) => setField(next, "connectors", slug, field, ref))
                    }
                  />
                  <Resolved editor={editor} token={connector[field as "width"]} />
                </span>
              ))}
              {connector.stub ? (
                <>
                  <Word>, stubbing</Word>
                  <RefToken
                    editor={editor}
                    value={connector.stub.depth}
                    kind="lengthParam"
                    title="How far the stub extrusion runs from the frame origin"
                    onPick={(ref) => write((next) => setStub(next, slug, "depth", ref))}
                  />
                  <RefToken
                    editor={editor}
                    value={connector.stub.direction}
                    kind="direction"
                    title="Which way the stub runs along the frame normal"
                    onPick={(ref) => write((next) => setStub(next, slug, "direction", ref))}
                  />
                </>
              ) : null}
              {connector.flowDirection ? (
                <span className="t-caption text-ink-mute">
                  · {connector.systemType} · flow {connector.flowDirection}
                </span>
              ) : null}
            </Line>
          );
        })}
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <div
        className="t-label t-upper mb-1 border-b pb-0.5 text-ink-2"
        style={{ borderColor: token("line") }}
      >
        {label}
      </div>
      <div className="space-y-1">{children}</div>
    </section>
  );
}

function Line({ lead, children }: { lead: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1">
      <span className="face-mono t-caption w-16 shrink-0 text-right text-ink-mute" aria-hidden>
        {lead}
      </span>
      {children}
    </div>
  );
}

const Word = ({ children }: { children: React.ReactNode }) => (
  <span className="t-label text-ink-2">{children}</span>
);

/** The token's number, for the staged type — the sentence stays readable as prose and still
 *  answers "what is that, right now". */
function Resolved({ editor, token }: { editor: Editor; token: string | undefined }) {
  const text = token ? nodeValue(editor.model, editor.typeName, token) : null;
  return text == null ? null : <span className="face-mono t-caption text-ink-mute">{text}</span>;
}
