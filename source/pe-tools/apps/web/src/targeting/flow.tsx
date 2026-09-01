import { ArtifactFrame } from "#/components/lang/artifact-frame";
import { cn } from "#/lib/utils";
import {
  freshnessWord,
  PaneStrip,
  Picker,
  SeamChip,
  type Bindings,
  type Runner,
} from "#/targeting/kit";
import {
  pathOf,
  targetMode,
  terminals,
  trunks,
  type Dir,
  type Link,
  type Product,
} from "#/targeting/model";

export const flowSide = (dir: Dir): "left" | "right" => (dir === "read" ? "left" : "right");

export function TargetCaption<K extends string>({ b, link }: { b: Bindings<K>; link: Link<K> }) {
  const feed = b.feeds[link.key];
  const fresh = freshnessWord(b, link);
  return (
    <span className="face-mono t-caption text-ink-mute">
      {targetMode(link)}
      {link.liveness ? ` · ${link.liveness}` : ""}
      {fresh ? ` · ${fresh}` : ""}
      {feed.basis?.length ? ` | basis ${feed.basis.join(" / ")}` : ""}
    </span>
  );
}

function Connector<K extends string>({ link, active }: { link: Link<K>; active: boolean }) {
  const both = link.dir === "sync" || link.dir === "duplex";
  const glyph =
    link.liveness === "detached" ? (both ? "←─○ ○─→" : "──○ ○─→") : both ? "←────→" : "─────→";
  return (
    <span
      aria-hidden
      className={cn(
        "face-mono t-caption shrink-0 text-center",
        active ? "text-ink" : "text-ink-mute",
      )}
      style={{ minWidth: 64 }}
    >
      {glyph}
    </span>
  );
}

function Terminal<K extends string>({
  product,
  link,
  side,
  b,
  runner,
  extra,
}: {
  product: Product<K>;
  link: Link<K>;
  side: "left" | "right";
  b: Bindings<K>;
  runner: Runner<K>;
  extra?: (link: Link<K>) => React.ReactNode;
}) {
  const dim = !b.demanded.has(link.key);
  const node = (
    <ArtifactFrame>
      <div
        className={cn(
          "flex min-w-36 flex-col px-2 py-1",
          side === "left" ? "items-end" : "items-start",
        )}
      >
        <TargetCaption b={b} link={link} />
        <span className="inline-flex items-baseline gap-1.5">
          <span className="face-mono t-caption text-ink-2">{link.joiner}</span>
          <Picker product={product} link={link} b={b} runner={runner} extra={extra} inert={dim} />
        </span>
      </div>
    </ArtifactFrame>
  );
  return (
    <div
      className="flex items-center"
      style={{ opacity: dim ? 0.45 : 1, flexDirection: side === "left" ? "row" : "row-reverse" }}
      title={dim ? `${link.key} is out of scope at ${b.stage.label}` : undefined}
    >
      {node}
      <Connector link={link} active={runner.active.has(link.key)} />
    </div>
  );
}

function Rail<K extends string>({
  product,
  side,
  b,
  runner,
  extra,
}: {
  product: Product<K>;
  side: "left" | "right";
  b: Bindings<K>;
  runner: Runner<K>;
  extra?: (link: Link<K>) => React.ReactNode;
}) {
  const links = terminals(product).filter((link) => flowSide(link.dir!) === side);
  return (
    <div
      className={`flex min-w-0 flex-col justify-center gap-1.5 ${side === "left" ? "items-end" : "items-start"}`}
    >
      <span className="t-label px-1">{side === "left" ? "reads" : "writes · syncs"}</span>
      {links.length ? (
        links.map((link) => (
          <Terminal
            key={link.key}
            product={product}
            link={link}
            side={side}
            b={b}
            runner={runner}
            extra={extra}
          />
        ))
      ) : (
        <span className="face-mono t-caption px-1 text-ink-mute">none</span>
      )}
    </div>
  );
}

export function TargetingFlow<K extends string>({
  product,
  b,
  runner,
  receipt,
  extra,
  fact,
  children,
}: {
  product: Product<K>;
  b: Bindings<K>;
  runner: Runner<K>;
  receipt?: React.ReactNode;
  extra?: (link: Link<K>) => React.ReactNode;
  fact?: React.ReactNode;
  children: React.ReactNode;
}) {
  const allTrunks = trunks(product);
  const ends = allTrunks.filter((trunk) => !allTrunks.some((child) => child.under === trunk.key));
  return (
    <div className="overflow-x-auto px-2">
      <div
        className="grid items-center"
        style={{ gridTemplateColumns: "minmax(12rem,1fr) minmax(24rem,1.35fr) minmax(12rem,1fr)" }}
      >
        <Rail product={product} side="left" b={b} runner={runner} extra={extra} />
        <ArtifactFrame
          head={
            <>
              <span className="t-label">{product.name}</span>
              <span className="t-label">trunks</span>
              {ends.map((end) => (
                <span key={end.key} className="face-mono t-caption text-ink-2">
                  {pathOf(product, end.key)
                    .filter((link) => link.dir === null)
                    .map((link) => b.labelOf(link) ?? link.placeholder)
                    .join(" › ")}
                </span>
              ))}
              <span className="ml-auto" />
              {fact}
              <SeamChip product={product} />
            </>
          }
          foot={
            <>
              <PaneStrip product={product} b={b} />
              {receipt ?? <span />}
            </>
          }
        >
          {children}
        </ArtifactFrame>
        <Rail product={product} side="right" b={b} runner={runner} extra={extra} />
      </div>
    </div>
  );
}
