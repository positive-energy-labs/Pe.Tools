import { Plus } from "lucide-react";
import type { ParameterLinkProfile } from "@pe/agent-contracts";
import { EmptyState } from "#/components/lang/empty";
import { Verb } from "#/components/lang/verb";
import { addDefinition } from "#/parameter-links/model";
import { DefinitionCard } from "./definition-card";

export function ProfileEditor({
  profile,
  disabled,
  fieldOptionsEnabled,
  target,
  onChange,
}: {
  profile: ParameterLinkProfile | null;
  disabled?: boolean;
  fieldOptionsEnabled?: boolean;
  target?: string;
  onChange: (next: ParameterLinkProfile) => void;
}) {
  if (!profile || profile.definitions.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <EmptyState story="scope" exit="add a definition to start linking parameters">
          no draft profile
        </EmptyState>
        <Verb
          label="add definition"
          icon={Plus}
          disabled={disabled}
          onClick={() => onChange(addDefinition(profile))}
          reason={
            disabled
              ? "the draft is busy — wait for the current command to finish"
              : "Add a blank link definition to the draft (local until saved)"
          }
        />
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
          fieldOptionsEnabled={fieldOptionsEnabled}
          target={target}
          onChange={onChange}
        />
      ))}
      <Verb
        label="add definition"
        icon={Plus}
        disabled={disabled}
        onClick={() => onChange(addDefinition(profile))}
        reason={
          disabled
            ? "the draft is busy — wait for the current command to finish"
            : "Add a blank link definition to the draft (local until saved)"
        }
      />
    </div>
  );
}
