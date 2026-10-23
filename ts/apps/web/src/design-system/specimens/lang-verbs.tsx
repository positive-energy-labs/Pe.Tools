import { Fragment, useState } from "react";
import { RefreshCw, Save, Upload } from "lucide-react";

import { ActionGroup, Button } from "@pe/kit/lang/button";
import { PreviewAction } from "@pe/kit/lang/preview-action";
import { HotkeyCommand, HotkeyHint } from "#/components/lang/hotkey-command";
import { Section } from "@pe/kit/lang/section";

import { SpecimenFrame } from "./recipe-grid";
import { SituationAction } from "#/route/situation-verbs";

const noop = () => {};

/** A read verb, fresh or with Work Revit changed since the read: stale, the verb wears the mark. */
const handleOf = (changed: boolean) =>
  ({
    manifest: { actions: { read: { rereads: "work" } } },
    readings: {},
    work: { changed },
    outcome: null,
    busy: null,
    stop: noop,
  }) as never;
const readVerb = {
  label: "read families",
  says: "Read the drafted families from this exact document.",
  refusal: null,
  count: null,
  run: noop,
} as never;

const KINDS = ["quiet", "framed", "commit"] as const;

/** A preview-then-do verb on a fake route: its preview rests on `input`, and moving it makes it stale. */
function PreviewActionSpecimen() {
  const [input, setInput] = useState(1);
  const [rest, setRest] = useState<number | null>(null);
  const held = rest === input;
  return (
    <div className="flex items-center gap-3">
      <PreviewAction
        label="preview heal"
        says="Preview healing 2 caps in Revit, rolled back"
        held={
          held
            ? {
                word: "heal · previewed 2",
                summary: "2 pass · 0 refused",
                lines: (
                  <ul className="m-0 list-none p-0 t-small">
                    <li>cap duct 12 (end 1)</li>
                    <li>cap duct 18 (end 0)</li>
                  </ul>
                ),
              }
            : null
        }
        stale={rest !== null && !held ? "changed since preview" : null}
        preview={async () => {
          setRest(input);
          return null;
        }}
        commit={{
          label: "apply heal",
          says: "Heal the items the preview passed, in one transaction",
          run: async () => {
            setRest(null);
            return null;
          },
          done: "healed 2",
        }}
      />
      <Button label="change the inputs" onClick={() => setInput((n) => n + 1)}>
        change the inputs
      </Button>
    </div>
  );
}

export function LangPressSpecimens() {
  return (
    <>
      <SpecimenFrame
        name="HotkeyCommand · modifier symbols / written chord / name + chord"
        importPath="#/components/lang/hotkey-command"
      >
        <div className="flex flex-wrap gap-4">
          <HotkeyHint hotkey="Mod+Shift+K" face="compact" />
          {(["compact", "medium", "full"] as const).map((face) => (
            <HotkeyCommand
              key={face}
              face={face}
              label={`Save fixture (${face})`}
              word="Save"
              hotkey="Mod+Shift+S"
              invoke={noop}
              bind={false}
            />
          ))}
        </div>
      </SpecimenFrame>
      <SpecimenFrame
        name="Button · kind × state (rest, pressed, refused, busy, icon-only)"
        importPath="@pe/kit/lang/button"
      >
        <div className="grid grid-cols-[auto_repeat(5,auto)] items-center justify-start gap-x-4 gap-y-2">
          {KINDS.map((kind) => (
            <Fragment key={kind}>
              <span className="t-small face-mono text-ink-2">{kind}</span>
              <Button
                kind={kind}
                label="save profile"
                icon={Save}
                reason="Writes the profile"
                onClick={noop}
              >
                save profile
              </Button>
              <Button kind={kind} label="raw json" pressed onClick={noop}>
                raw json
              </Button>
              <Button
                kind={kind}
                label="sync to .r10"
                refusal="no .r10 target is bound"
                onClick={noop}
              >
                sync to .r10
              </Button>
              <Button kind={kind} label="apply" busy onClick={noop}>
                apply
              </Button>
              <Button kind={kind} label="Refresh the read" icon={RefreshCw} onClick={noop} />
            </Fragment>
          ))}
          <span className="t-small face-mono text-ink-2">nav</span>
          <Button kind="nav" direction="back" label="all types" onClick={noop}>
            all types
          </Button>
          <Button kind="nav" direction="forward" label="open" onClick={noop}>
            open
          </Button>
          <Button kind="nav" direction="out" label="open in RHVAC" onClick={noop}>
            open in RHVAC
          </Button>
        </div>
      </SpecimenFrame>
      <Section label="ActionGroup · blast radius is a label">
        <ActionGroup title="writes beyond the page" radius="document · model · external">
          <Button kind="commit" label="apply to Revit" icon={Upload} onClick={noop}>
            apply to Revit
          </Button>
        </ActionGroup>
      </Section>
      <SpecimenFrame
        name="PreviewAction · idle, previewing, armed (popover open or closed), stale, committed"
        importPath="@pe/kit/lang/preview-action"
      >
        <PreviewActionSpecimen />
      </SpecimenFrame>
      <SpecimenFrame
        name="Subject reference · rest, its block hovered, lit (token hovered or focused); the picture's badge"
        importPath="@pe/kit/lang/lang.css"
      >
        <div className="grid grid-cols-[auto_auto] items-center justify-start gap-x-4 gap-y-2 t-prose">
          <span className="t-small face-mono text-ink-2">rest</span>
          <span>
            ends open at{" "}
            <button type="button" className="subject-ref">
              9×9 transition<span className="subject-mark">1</span>
            </button>
          </span>
          <span className="t-small face-mono text-ink-2">block</span>
          <span data-subject-text="" data-lit="">
            ends open at{" "}
            <button type="button" className="subject-ref">
              9×9 transition<span className="subject-mark">1</span>
            </button>
          </span>
          <span className="t-small face-mono text-ink-2">lit</span>
          <span>
            ends open at{" "}
            <button type="button" className="subject-ref" data-lit="">
              9×9 transition<span className="subject-mark">1</span>
            </button>
          </span>
          <span className="t-small face-mono text-ink-2">badge</span>
          <svg width="64" height="24" aria-hidden>
            <g className="subject-badge" transform="translate(12 12)">
              <circle r={9} />
              <text y={3.5} textAnchor="middle">
                1
              </text>
            </g>
            <g className="subject-badge" data-lit="" transform="translate(40 12)">
              <circle r={9} />
              <text y={3.5} textAnchor="middle">
                2
              </text>
            </g>
          </svg>
        </div>
      </SpecimenFrame>
      <Section label="SituationAction · fresh · stale (caution edge and wash)">
        <span className="inline-flex gap-2">
          <SituationAction handle={handleOf(false)} name="read" action={readVerb} chord="R" />
          <SituationAction handle={handleOf(true)} name="read" action={readVerb} chord="R" />
        </span>
      </Section>
    </>
  );
}
