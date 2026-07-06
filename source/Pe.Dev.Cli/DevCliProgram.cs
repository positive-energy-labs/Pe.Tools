namespace Pe.Dev.Cli;

internal static class DevCliProgram {
  internal const string UsageText = """
                                      Usage:
                                        pe-dev bootstrap-path
                                        pe-dev self-test [--json]
                                        pe-dev pea link-dev
                                        pe-dev web <pea|peco> [web options]
                                        pe-dev automation <auth|browse|manifest|submit|inspect|cache> ...

                                      Primary workflow:
                                        bootstrap-path  Add the running pe-dev build output directory to the user PATH.

                                      Removed command groups:
                                        codegen was removed: ops/types come from the live session (GET /ops + host-typegen).
                                        doctor, status, sync, env, revit, verify, and test were intentionally removed from the public surface.
                                        Use SDK pe-revit live/test for live-loop mechanics and Revit-backed proof.
                                        Use Peco when Pea status/log hooks or product probes should wrap SDK commands.

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
