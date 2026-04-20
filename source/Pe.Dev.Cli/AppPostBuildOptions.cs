namespace Pe.Dev.Cli;

internal sealed record AppPostBuildOptions(string ScriptDirectory, int TimeoutSeconds)
{
    public static AppPostBuildOptions Parse(IReadOnlyList<string> args, string defaultScriptDirectory)
    {
        string scriptDirectory = defaultScriptDirectory;
        var timeoutSeconds = 60;

        for (var i = 0; i < args.Count; i++)
        {
            var arg = args[i];
            switch (arg.ToLowerInvariant())
            {
                case "--script-directory":
                case "-scriptdirectory":
                    scriptDirectory = RequireValue(args, ref i, arg);
                    break;
                case "--timeout-seconds":
                case "-timeoutseconds":
                    timeoutSeconds = int.Parse(
                        RequireValue(args, ref i, arg),
                        System.Globalization.CultureInfo.InvariantCulture
                    );
                    break;
                default:
                    throw new ArgumentException($"Unknown argument '{arg}' for app-post-build.");
            }
        }

        return new AppPostBuildOptions(Path.GetFullPath(scriptDirectory), timeoutSeconds);
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName)
    {
        if (index + 1 >= args.Count)
        {
            throw new ArgumentException($"Missing value for {optionName}.");
        }

        index++;
        return args[index];
    }
}
