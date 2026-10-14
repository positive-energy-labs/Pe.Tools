import { Fragment } from "react";
import { RefreshCw, Save, Upload } from "lucide-react";

import { ActionGroup, Button } from "@pe/kit/lang/button";
import { HotkeyCommand, HotkeyHint } from "#/components/lang/hotkey-command";
import { Section } from "#/components/lang/section";

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
      <Section label="SituationAction · fresh · stale (caution edge and wash)">
        <span className="inline-flex gap-2">
          <SituationAction handle={handleOf(false)} name="read" action={readVerb} chord="R" />
          <SituationAction handle={handleOf(true)} name="read" action={readVerb} chord="R" />
        </span>
      </Section>
    </>
  );
}
