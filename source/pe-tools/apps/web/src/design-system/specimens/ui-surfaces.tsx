import { Press } from "#/components/lang/press";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardRecipe,
} from "#/components/lang/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
              <CardHeader>
                <div>
                  <CardTitle>Overhead Coiling Door 421</CardTitle>
                  <CardDescription>13 params</CardDescription>
                </div>
                <CardAction>
                  <Press size="label">open</Press>
                </CardAction>
              </CardHeader>
              <CardContent>content</CardContent>
              <CardFooter>footer</CardFooter>
            </Card>
          </div>
        )}
      />
      <RecipeGrid
        name="Dialog"
        importPath="#/components/lang/dialog"
        recipe={dialogRecipe}
        render={() => (
          <Dialog>
            <DialogTrigger render={<Press size="label" />}>open dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog</DialogTitle>
                <DialogDescription>
                  Backdrop, portal, close, escape, and click-outside.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        )}
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
