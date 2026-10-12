import { Button } from "#/components/lang/button";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  dialogRecipe,
} from "#/components/lang/dialog";
import { ValueDiff, valueDiffRecipe } from "#/components/lang/value-diff";
import { Rail } from "#/components/lang/rail";
import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

export function UiSurfaceSpecimens() {
  return (
    <>
      <SpecimenFrame name="Rail" importPath="#/components/lang/rail">
        <div className="grid w-80 gap-2">
          <Rail lead={<span className="t-small t-upper">lead only</span>} />
          <Rail
            ground="recess"
            lead={<span className="t-small t-upper">lead and trail</span>}
            trail={<Button label="open">open</Button>}
          />
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="Dialog"
        importPath="#/components/lang/dialog"
        recipe={dialogRecipe}
        render={() => <DialogSpecimen />}
      />
      <RecipeGrid
        name="ValueDiff"
        importPath="#/components/lang/value-diff"
        recipe={valueDiffRecipe}
        render={() => <ValueDiff from="100 VA" to="150 VA" />}
      />
    </>
  );
}

function DialogSpecimen() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label="open dialog" onClick={() => setOpen(true)}>
        open dialog
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Backdrop, portal, close, escape, and click-outside</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}
