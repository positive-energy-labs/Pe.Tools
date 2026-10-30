import { Plus } from "lucide-react";
import type { ParameterLinkProfile } from "@pe/agent-contracts";
import { EmptyState } from "@pe/kit/lang/empty";
import { Button } from "@pe/kit/lang/button";
import { addDefinition } from "#/parameter-links/model";
import { DefinitionCard } from "./definition-card";
import type { ProfileOptions } from "../sources";

export function ProfileEditor({
  profile,
  disabled,
  options,
  onChange,
}: {
  profile: ParameterLinkProfile | null;
  disabled?: boolean;
  options: ProfileOptions;
  onChange: (next: ParameterLinkProfile) => void;
}) {
  if (!profile || profile.definitions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <EmptyState story="scope" exit="add a definition to start linking parameters">
          no draft profile
        </EmptyState>
        <Button
          label="add definition"
          kind="framed"
          icon={Plus}
          refusal={disabled ? "the draft is busy — wait for the current command to finish" : null}
          onClick={() => onChange(addDefinition(profile))}
          reason="Add a blank link definition to the shared draft"
        >
          add definition
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {profile.definitions.map((definition) => (
        <DefinitionCard
          key={definition.id}
          profile={profile}
          definition={definition}
          disabled={disabled}
          options={options}
          onChange={onChange}
        />
      ))}
      <Button
        label="add definition"
        kind="framed"
        icon={Plus}
        refusal={disabled ? "the draft is busy — wait for the current command to finish" : null}
        onClick={() => onChange(addDefinition(profile))}
        reason="Add a blank link definition to the shared draft"
      >
        add definition
      </Button>
    </div>
  );
}
