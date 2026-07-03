using Pe.Shared.Codegen;

namespace Pe.Shared.ApsAuth;

[ExportTsSchema]
public sealed record ApsLogoutResult(bool LoggedOut);
