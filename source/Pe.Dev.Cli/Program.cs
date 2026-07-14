using Pe.Dev.Cli;

const string usage = """
                     Usage:
                       pe-dev automation <auth|browse|manifest|submit|inspect|cache> ...

                     Global options:
                       --repo-root <path>   Override repo root discovery.
                       --help, -h           Show this help text.

                     Web development is not a pe-dev responsibility. Use:
                       pnpm --dir source/pe-tools dev
                     """;

if (args.Length == 0 || args is ["--help" or "-h"]) {
    Console.WriteLine(usage);
    return;
}

string? repoRoot = null;
var commandArgs = new List<string>();
for (var index = 0; index < args.Length; index++) {
    if (args[index] != "--repo-root") {
        commandArgs.Add(args[index]);
        continue;
    }

    if (++index >= args.Length) {
        Console.Error.WriteLine("Missing value for --repo-root.");
        Environment.ExitCode = 10;
        return;
    }

    repoRoot = args[index];
}

if (commandArgs.Count == 0 || !string.Equals(commandArgs[0], "automation", StringComparison.OrdinalIgnoreCase)) {
    Console.Error.WriteLine("The only pe-dev command is `automation`.");
    Console.Error.WriteLine(usage);
    Environment.ExitCode = 10;
    return;
}

Environment.ExitCode = await AutomationCommandRunner.RunAsync(
    commandArgs.Skip(1).ToArray(),
    repoRoot,
    CancellationToken.None
);
