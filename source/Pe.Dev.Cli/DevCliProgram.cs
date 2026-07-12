namespace Pe.Dev.Cli;

internal static class DevCliProgram {
  internal const string UsageText = """
                                      Usage:
                                        pe-dev self-test [--json]
                                        pe-dev web pea [web options]
                                        pe-dev automation <auth|browse|manifest|submit|inspect|cache> ...

                                      PATH and dev shims are SDK-owned:
                                        `pe-revit path ensure` registers the product shims dir on the user PATH (once).
                                        `pe-revit dev link` routes pea/pe-dev shims to this checkout; `pe-revit dev status` shows lanes.

                                      Removed command groups:
                                        bootstrap-path and pea link-dev were removed: they hand-edited the user PATH and kept a second
                                        shim generator. Use `pe-revit path ensure` + `pe-revit dev link` instead.
                                        codegen was removed: ops/types come from the live session (GET /ops + `pnpm --filter @pe/host-contracts codegen`).
                                        doctor, status, sync, env, revit, verify, and test were intentionally removed from the public surface.
                                        Use SDK `pe-revit live` for live-loop mechanics and `pe-revit test fresh|attached` for Revit-backed proof.
                                        Use the pea MCP tools (pe_status, pe_logs) for Pea status/log hooks and product probes.

                                      Global options:
                                        --repo-root <path>   Override repo root discovery.
                                        --help, -h           Show this help text.
                                      """;

  public static async Task<int> RunAsync(string[] args, CancellationToken cancellationToken) {
    DevCliParseResult parseResult;
    try {
      parseResult = DevCliOptions.Parse(args);
    } catch (Exception ex) {
      Console.Error.WriteLine(ex.Message);
      Console.Error.WriteLine(UsageText);
      return 10;
    }

    if (!parseResult.Success || parseResult.Options is null) {
      if (!string.IsNullOrWhiteSpace(parseResult.ErrorMessage)) {
        Console.Error.WriteLine(parseResult.ErrorMessage);
        if (parseResult.ShowUsage) Console.Error.WriteLine(UsageText);
        return 10;
      }

      if (parseResult.ShowUsage) Console.WriteLine(UsageText);
      return 0;
    }

    return await RootCommandRunner.RunAsync(parseResult.Options, cancellationToken);
  }
}
