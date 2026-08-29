import { Press } from "#/components/lang/press";
import { Badge, badgeVariants } from "#/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  dialogRecipe,
} from "#/components/ui/dialog";
import { ValueDiff } from "#/components/ui/value-diff";

import { RecipeGrid, SpecimenFrame } from "./recipe-grid";

export function UiSurfaceSpecimens() {
  return (
    <>
      <RecipeGrid
        name="Badge"
        importPath="#/components/ui/badge"
        recipe={badgeVariants}
        render={(props) => (
          <Badge
            variant={
              props.variant as
                | "default"
                | "secondary"
                | "outline"
                | "destructive"
                | "blue"
                | "green"
                | "slate"
                | "lichen"
                | "clay"
                | "kiln"
            }
          >
            {String(props.variant)}
          </Badge>
        )}
      />
      <SpecimenFrame name="Card" importPath="#/components/ui/card">
        <div className="w-80">
          <Card>
            <CardHeader>
              <div className="min-w-0">
                <CardTitle>Overhead Coiling Door 421</CardTitle>
                <CardDescription>13 params · 3 types</CardDescription>
              </div>
              <CardAction>
                <Press className="inline-flex h-6 items-center px-2">open</Press>
              </CardAction>
            </CardHeader>
            <CardContent>content</CardContent>
            <CardFooter>footer</CardFooter>
          </Card>
        </div>
      </SpecimenFrame>
      <RecipeGrid
        name="Dialog"
        importPath="#/components/ui/dialog"
        recipe={dialogRecipe}
        render={() => (
          <Dialog>
            <DialogTrigger render={<Press className="inline-flex h-6 items-center px-2" />}>
              open dialog
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Dialog</DialogTitle>
                <DialogDescription>
                  Backdrop, portal, close button, escape, and click-outside.
                </DialogDescription>
              </DialogHeader>
            </DialogContent>
          </Dialog>
        )}
      />
      <SpecimenFrame name="ValueDiff" importPath="#/components/ui/value-diff">
        <div className="flex flex-col gap-3">
          <ValueDiff from="100 VA" to="150 VA" />
          <ValueDiff from={null} to="2 hr" />
          <ValueDiff from="24 in" to="24 in" />
          <ValueDiff from="" to="115 V" />
        </div>
      </SpecimenFrame>
    </>
  );
}
