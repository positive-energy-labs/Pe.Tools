import { RefreshCw, Save, Sparkles, Upload } from "lucide-react";

import { Press } from "#/components/lang/press";
import { Section } from "#/components/lang/section";
import { Verb, VerbGroup } from "#/components/lang/verb";

const noop = () => {};

export function LangVerbSpecimens() {
  return (
    <Section label="lang · verbs and controls">
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Verb label="collapse" reason="Collapses this region" onClick={noop} />
          <Verb tone="agent" label="ask pea" icon={Sparkles} reason="Asks Pea" onClick={noop} />
          <Verb
            tone="commit"
            label="apply"
            icon={Upload}
            reason="Writes to the model"
            onClick={noop}
          />
          <Verb tone="nav" direction="back" label="all types" reason="Returns" onClick={noop} />
          <Verb label="refresh" icon={RefreshCw} reason="Re-reads the model" onClick={noop} busy />
          <Verb label="open" reason="No target is bound" onClick={noop} disabled />
        </div>
        <VerbGroup title="writes beyond the page" radius="document · model · external">
          <Verb
            tone="commit"
            label="save profile"
            icon={Save}
            reason="Writes the profile"
            onClick={noop}
          />
          <Verb label="refresh" icon={RefreshCw} reason="Re-reads the model" onClick={noop} />
        </VerbGroup>
        <div className="flex items-center gap-3">
          <Press size="sm">raw json</Press>
          <Press size="icon-sm" aria-label="refresh">
            <RefreshCw className="size-3" />
          </Press>
          <Press disabled size="sm">
            disabled
          </Press>
        </div>
      </div>
    </Section>
  );
}
