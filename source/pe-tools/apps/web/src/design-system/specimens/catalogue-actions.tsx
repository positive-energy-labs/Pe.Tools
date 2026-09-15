import { RefreshCw, Save, Sparkles, Upload } from "lucide-react";

import { Press } from "#/components/lang/press";
import { ActionButton, ActionGroup } from "#/components/lang/action-button";
import { CounterExample, Demo, Gap } from "#/design-system/exhibit";

import { ActionDemoCatalogue } from "../action-demo-catalogue";

const noop = () => {};

export function CatalogueActions() {
  return (
    <>
      <ActionDemoCatalogue />
      <Demo
        label="Press"
        consumers="theme toggle, popover triggers, tabs, and surface machinery"
        spec="Press is a mechanism on the current surface. It may select, disclose, or move local state. It never claims a world action."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Press>raw json</Press>
          <Press tone="quiet">secondary view</Press>
          <Press state="selected" aria-pressed>
            selected
          </Press>
          <Press size="icon" aria-label="refresh" title="Refresh this view">
            <RefreshCw />
          </Press>
        </div>
        <CounterExample why="saving changes is a world action and needs ActionButton.reason">
          <Press>save profile</Press>
        </CounterExample>
      </Demo>

      <Demo
        label="ActionButton · ActionGroup"
        consumers="arming strips, document actions, navigation, and Pea actions"
        spec="ActionButton acts in the world and requires a human-readable reason. Tone says the kind of action; ActionGroup says blast radius without minting another hue."
      >
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          <ActionGroup title="stays here" radius="page · document">
            <ActionButton
              label="refresh"
              icon={RefreshCw}
              onClick={noop}
              reason="Re-reads the model"
            />
            <ActionButton
              tone="agent"
              label="ask pea"
              icon={Sparkles}
              onClick={noop}
              reason="Hands this scope to Pea"
            />
          </ActionGroup>
          <ActionGroup title="goes somewhere" radius="back · forward · out">
            <ActionButton
              tone="nav"
              direction="back"
              label="all types"
              onClick={noop}
              reason="Returns to the type list"
            />
            <ActionButton
              tone="nav"
              direction="out"
              label="open in RHVAC"
              onClick={noop}
              reason="Leaves Pe.Tools"
            />
          </ActionGroup>
          <ActionGroup title="writes beyond the page" radius="document · model · external">
            <ActionButton
              tone="commit"
              label="save profile"
              icon={Save}
              onClick={noop}
              reason="Writes the family profile"
            />
            <ActionButton
              tone="commit"
              label="apply to Revit"
              icon={Upload}
              onClick={noop}
              reason="Writes 42 parameters into the model"
            />
            <ActionButton
              tone="commit"
              label="sync to .r10"
              onClick={noop}
              disabled
              reason="no .r10 target is bound"
            />
          </ActionGroup>
        </div>
        <CounterExample why="a disabled Press can omit the refusal reason">
          <Press disabled>sync to .r10</Press>
        </CounterExample>
        <Gap>
          ActionButton composes busy and disabled props, but both render as one inert state. A world
          action cannot say that it is busy and independently refused.
        </Gap>
      </Demo>
    </>
  );
}
