using Pe.Shared.HostContracts.Scripting;

namespace Pe.Shared.Scripting.Policy;

public sealed record ScriptPolicyContext(
    ScriptPermissionMode PermissionMode
);
