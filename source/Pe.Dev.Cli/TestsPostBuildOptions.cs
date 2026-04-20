using System.Globalization;

namespace Pe.Dev.Cli;

internal sealed record TestsPostBuildOptions(string ScriptDirectory, int RevitYear) {
    public static TestsPostBuildOptions Parse(IReadOnlyList<string> args, string defaultScriptDirectory) {
        var scriptDirectory = defaultScriptDirectory;
        var revitYear = 2025;

        for (var i = 0; i < args.Count; i++) {
            var arg = args[i];
            switch (arg.ToLowerInvariant()) {
            case "--script-directory":
            case "-scriptdirectory":
                scriptDirectory = RequireValue(args, ref i, arg);
                break;
            case "--revit-year":
            case "-revityear":
                revitYear = int.Parse(
                    RequireValue(args, ref i, arg),
                    CultureInfo.InvariantCulture
                );
                break;
            default:
                throw new ArgumentException($"Unknown argument '{arg}' for tests-post-build.");
            }
        }

        return new TestsPostBuildOptions(Path.GetFullPath(scriptDirectory), revitYear);
    }

    private static string RequireValue(IReadOnlyList<string> args, ref int index, string optionName) {
        if (index + 1 >= args.Count) throw new ArgumentException($"Missing value for {optionName}.");

        index++;
        return args[index];
    }
}