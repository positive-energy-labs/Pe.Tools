import { RefreshCw, Save, Square, Upload } from "lucide-react";

import { ActionGroup, Button } from "@pe/kit/lang/button";
import { CounterExample, Demo, Gap } from "#/design-system/exhibit";

import { ActionDemoCatalogue } from "../action-demo-catalogue";
import { FirstRunSeedsDemo, UpdateStatesDemo } from "../first-run-seeds";
import { MachineSeedsDemo } from "../machine-seeds";

const noop = () => {};

export function CatalogueActions() {
  return (
    <>
      <ActionDemoCatalogue />
      <MachineSeedsDemo />
      <UpdateStatesDemo />
      <FirstRunSeedsDemo />
      <Demo
        label="Button · ActionGroup"
        consumers="every control that acts: theme toggle, popover triggers, tabs, arming strips, document actions, navigation"
        spec="Button is the one control. label is required (its name, and its tooltip when it draws only a glyph); reason says what pressing does; refusal keeps it focusable and says why it will not. kind: quiet (veil only), framed (the control frame), commit (the one filled blue), nav (with its direction's arrow). ActionGroup says blast radius without minting another hue."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button label="secondary view" onClick={noop}>
            secondary view
          </Button>
          <Button label="selected" pressed onClick={noop}>
            selected
          </Button>
          <Button label="Refresh this view" icon={RefreshCw} onClick={noop} />
        </div>
        <div className="flex flex-wrap gap-x-10 gap-y-5">
          <ActionGroup title="stays here" radius="page · document">
            <Button
              kind="framed"
              label="refresh"
              icon={RefreshCw}
              onClick={noop}
              reason="Re-reads the model"
            >
              refresh
            </Button>
          </ActionGroup>
          <ActionGroup title="goes somewhere" radius="back · forward · out">
            <Button
              kind="nav"
              direction="back"
              label="all types"
              onClick={noop}
              reason="Returns to the type list"
            >
              all types
            </Button>
            <Button
              kind="nav"
              direction="out"
              label="open in RHVAC"
              onClick={noop}
              reason="Leaves Pe.Tools"
            >
              open in RHVAC
            </Button>
          </ActionGroup>
          <ActionGroup title="stops what runs" radius="turn">
            <Button
              kind="framed"
              icon={Square}
              label="Stop: stops the running turn"
              data-tone="alarm"
              onClick={noop}
            />
          </ActionGroup>
          <ActionGroup title="writes beyond the page" radius="document · model · external">
            <Button
              kind="commit"
              label="save profile"
              icon={Save}
              onClick={noop}
              reason="Writes the family profile"
            >
              save profile
            </Button>
            <Button
              kind="commit"
              label="apply to Revit"
              icon={Upload}
              onClick={noop}
              reason="Writes 42 parameters into the model"
            >
              apply to Revit
            </Button>
            <Button
              kind="commit"
              label="sync to .r10"
              onClick={noop}
              refusal="no .r10 target is bound"
            >
              sync to .r10
            </Button>
          </ActionGroup>
        </div>
        <CounterExample why="a Button without a refusal stays live; an unavailable action must say why">
          <Button label="sync to .r10" onClick={noop}>
            sync to .r10
          </Button>
        </CounterExample>
        <Gap>
          busy and refusal render as one inert state. A world action cannot say that it is busy and
          independently refused.
        </Gap>
      </Demo>
    </>
  );
}
