namespace Pe.Dev.Cli;

internal static class EnvCommandRunner {
    public static int RunLogs(IReadOnlyList<string> forwardedArguments) {
        EnvLogOptions options;
        try {
            options = EnvLogOptions.Parse(forwardedArguments);
        } catch (Exception ex) {
            Console.Error.WriteLine(ex.Message);
            return 10;
        }

        foreach (var (label, filePath) in options.ResolveLogFiles()) {
            Console.WriteLine($"== {label} log ==");
            Console.WriteLine(filePath);

            var lines = File.Exists(filePath) ? File.ReadAllLines(filePath) : [];
            var startIndex = Math.Max(0, lines.Length - options.TailLineCount);
            if (lines.Length == 0)
                Console.WriteLine("(empty)");
            else {
                for (var i = startIndex; i < lines.Length; i++)
                    Console.WriteLine(lines[i]);
            }

            Console.WriteLine();
        }

        return 0;
    }
}
