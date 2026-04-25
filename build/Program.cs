using Build;
using Build.Modules;
using Build.Options;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ModularPipelines;
using ModularPipelines.Extensions;

var parsedArgs = BuildCliArguments.Parse(args);
var builder = Pipeline.CreateBuilder();

builder.Configuration.AddJsonFile("appsettings.json");
builder.Configuration.AddUserSecrets<Program>();
builder.Configuration.AddEnvironmentVariables();

builder.Services.AddOptions<BuildOptions>().Bind(builder.Configuration.GetSection("Build"));
builder.Services.AddOptions<BundleOptions>().Bind(builder.Configuration.GetSection("Bundle"));
builder.Services.AddOptions<InstallerOptions>().Bind(builder.Configuration.GetSection("Installer"));
builder.Services.AddOptions<PublishOptions>().Bind(builder.Configuration.GetSection("Publish"));
builder.Services.PostConfigure<BuildOptions>(options =>
    options.Configuration = parsedArgs.Configuration ?? options.Configuration);

if (parsedArgs.Commands.Contains("pack")) {
    _ = builder.Services.AddModule<CleanProjectModule>();
    _ = builder.Services.AddModule<CreateBundleModule>();
    _ = builder.Services.AddModule<CreateAutomationBundleModule>();
    _ = builder.Services.AddModule<CreateInstallerModule>();
}

if (parsedArgs.Commands.Contains("publish"))
    _ = builder.Services.AddModule<PublishGithubModule>();

await builder.Build().RunAsync();

namespace Build {
    internal sealed record BuildCliArguments(
        string? Configuration,
        HashSet<string> Commands
    ) {
        private static readonly HashSet<string> SupportedCommands =
            ["pack", "publish"];

        public static BuildCliArguments Parse(IReadOnlyList<string> args) {
            string? configuration = null;
            var commands = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            for (var i = 0; i < args.Count; i++) {
                var arg = args[i];
                switch (arg) {
                case "--configuration":
                    if (i + 1 >= args.Count)
                        throw new ArgumentException("Missing value for --configuration.");

                    configuration = args[++i];
                    break;
                default:
                    commands.Add(arg);
                    break;
                }
            }

            if (commands.Count == 0)
                throw new ArgumentException("Expected at least one command. Supported commands: pack, publish.");

            var unsupportedCommands = commands
                .Where(command => !SupportedCommands.Contains(command))
                .OrderBy(command => command, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (unsupportedCommands.Length > 0)
                throw new ArgumentException(
                    $"Unsupported command(s): {string.Join(", ", unsupportedCommands)}. Supported commands: pack, publish.");

            return new BuildCliArguments(configuration, commands);
        }
    }
}

// PE_HOT_RELOAD_NUDGE
