import type { WorkbenchApprovalRequest } from "@pe/agent-contracts";
import { selectPendingApprovals } from "@pe/agent-projection";
import type { WorkbenchState } from "@pe/agent-contracts";
import type { WorkbenchCommands } from "../../workbench/use-workbench.ts";
import { JsonBlock } from "../debug/JsonBlock.tsx";

export function ApprovalDock({
  state,
  commands,
}: {
  state: WorkbenchState;
  commands: WorkbenchCommands;
}) {
  const approvals = selectPendingApprovals(state);
  if (approvals.length === 0) return null;
  return (
    <section className="approval-dock">
      <h2>Pending approvals</h2>
      {approvals.map((approval) => (
        <ApprovalCard key={approval.requestId} approval={approval} commands={commands} />
      ))}
    </section>
  );
}

function ApprovalCard({
  approval,
  commands,
}: {
  approval: WorkbenchApprovalRequest;
  commands: WorkbenchCommands;
}) {
  return (
    <article className="approval-card">
      <div className="section-heading">
        <h3>{approval.toolCall.title}</h3>
        <span>{approval.status}</span>
      </div>
      <div className="muted small">{approval.requestId}</div>
      {approval.toolCall.rawInput ? <JsonBlock value={approval.toolCall.rawInput} /> : null}
      <div className="button-row wrap">
        {approval.options.map((option) => (
          <button
            key={option.optionId}
            type="button"
            className={option.optionId === approval.defaultOptionId ? "primary" : ""}
            onClick={() => void commands.resolveApproval(approval.requestId, option.optionId)}
          >
            {option.name}
          </button>
        ))}
      </div>
    </article>
  );
}
