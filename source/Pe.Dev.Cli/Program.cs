using Pe.Dev.Cli;

var exitCode = await DevCliProgram.RunAsync(args, CancellationToken.None);
Environment.Exit(exitCode);
