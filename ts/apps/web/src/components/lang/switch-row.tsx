import { Switch } from "./switch";

/**
 * A switch with its refusal beside it: a refused switch is disabled and says why on the surface,
 * not in a title.
 */
export function SwitchRow({
  label,
  checked,
  onCheckedChange,
  refusal,
  disabled = false,
  says,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Present, the switch cannot move; this sentence says why. */
  refusal?: string | null;
  /** The switch cannot move, and nothing was refused; the caller says why in its own words. */
  disabled?: boolean;
  /** What turning it on does. */
  says: string;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <label className="flex items-center gap-2" title={says}>
        <span className="min-w-0 flex-1">{label}</span>
        <Switch
          size="sm"
          checked={checked}
          disabled={disabled || Boolean(refusal)}
          onCheckedChange={onCheckedChange}
        />
      </label>
      {refusal ? <span data-tone="caution">{refusal}</span> : null}
    </span>
  );
}
