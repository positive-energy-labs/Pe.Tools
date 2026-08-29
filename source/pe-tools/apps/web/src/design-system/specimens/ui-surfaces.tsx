import { Badge } from "#/components/ui/badge";
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
} from "#/components/ui/dialog";
import { ValueDiff } from "#/components/ui/value-diff";
import { Press } from "#/components/lang/press";
import { Section } from "#/components/lang/section";

const BADGE_VARIANTS = [
  "default",
  "secondary",
  "outline",
  "destructive",
  "blue",
  "green",
  "slate",
  "lichen",
  "clay",
  "kiln",
] as const;

export function UiSurfaceSpecimens() {
  return (
    <Section label="ui · surfaces">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          {BADGE_VARIANTS.map((variant) => (
            <Badge key={variant} variant={variant}>
              {variant}
            </Badge>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
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
          <div className="flex flex-col gap-3">
            <ValueDiff from="100 VA" to="150 VA" />
            <ValueDiff from={null} to="2 hr" />
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
          </div>
        </div>
      </div>
    </Section>
  );
}
