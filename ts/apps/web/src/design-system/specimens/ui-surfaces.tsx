import { Press } from "#/components/lang/press";
import { useState } from "react";
import { Card, cardRecipe } from "#/components/lang/card";
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
            trail={<Press size="label">open</Press>}
          />
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="Card"
        importPath="#/components/lang/card"
        recipe={cardRecipe}
        render={() => (
          <div className="w-80">
            <Card>
              <span className="t-title p-5">Overhead Coiling Door 421</span>
            </Card>
          </div>
        )}
      />
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
      <Press size="label" onClick={() => setOpen(true)}>
        open dialog
      </Press>
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
