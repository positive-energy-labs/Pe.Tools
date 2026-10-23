import { Button } from "@pe/kit/lang/button";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  dialogRecipe,
} from "@pe/kit/lang/dialog";
import { ValueDiff, valueDiffRecipe } from "@pe/kit/lang/value-diff";
import { Rail } from "@pe/kit/lang/rail";
import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

export function UiSurfaceSpecimens() {
  return (
    <>
      <SpecimenFrame name="Rail" importPath="@pe/kit/lang/rail">
        <div className="grid w-80 gap-2">
          <Rail lead={<span className="t-small t-upper">lead only</span>} />
          <Rail
            ground="recess"
            lead={<span className="t-small t-upper">lead and trail</span>}
            trail={<Button label="open">open</Button>}
          />
          <Rail
            lead={<Button label="Menu">Menu</Button>}
            center={<span className="t-small">Centered title</span>}
            trail={<Button label="Action">Action</Button>}
          />
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="Dialog"
        importPath="@pe/kit/lang/dialog"
        recipe={dialogRecipe}
        render={() => <DialogSpecimen />}
      />
      <RecipeGrid
        name="ValueDiff"
        importPath="@pe/kit/lang/value-diff"
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
