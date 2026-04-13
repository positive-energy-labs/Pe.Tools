using System.Text;

namespace Pe.Revit.Scripting.Execution;

internal sealed class ScriptOutputSink {
    private readonly StringBuilder _output = new();
    private readonly object _sync = new();

    public string GetBufferedOutput() {
        lock (this._sync)
            return this._output.ToString();
    }

    public ConsoleCaptureScope CreateConsoleCaptureScope() => new(this);

    public void WriteLine(string message) {
        var line = message ?? string.Empty;
        if (!line.EndsWith(Environment.NewLine, StringComparison.Ordinal))
            line += Environment.NewLine;

        this.WriteOutput(line);
    }

    public void WriteOutput(string output) {
        if (string.IsNullOrEmpty(output))
            return;

        lock (this._sync)
            this._output.Append(output);
    }
}

internal sealed class ConsoleCaptureScope : IDisposable {
    private readonly TextWriter _originalConsoleOut = Console.Out;
    private readonly ScriptConsoleWriter _scriptConsoleWriter;

    public ConsoleCaptureScope(ScriptOutputSink outputSink) {
        this._scriptConsoleWriter = new ScriptConsoleWriter(outputSink);
        Console.SetOut(this._scriptConsoleWriter);
    }

    public void Dispose() {
        this._scriptConsoleWriter.Flush();
        Console.SetOut(this._originalConsoleOut);
        this._scriptConsoleWriter.Dispose();
    }

    private sealed class ScriptConsoleWriter(
        ScriptOutputSink outputSink
    ) : TextWriter {
        private readonly StringBuilder _buffer = new();
        private readonly ScriptOutputSink _outputSink = outputSink;

        public override Encoding Encoding => Encoding.UTF8;

        public override void Write(char value) {
            this._buffer.Append(value);
            this.FlushCompletedLines();
        }

        public override void Write(string? value) {
            if (string.IsNullOrEmpty(value))
                return;

            this._buffer.Append(value);
            this.FlushCompletedLines();
        }

        public override void WriteLine(string? value) {
            this.Write(value);
            this.Write(Environment.NewLine);
        }

        public override void WriteLine() =>
            this.Write(Environment.NewLine);

        public override void Flush() {
            if (this._buffer.Length == 0)
                return;

            this._outputSink.WriteOutput(this._buffer.ToString());
            this._buffer.Clear();
        }

        private void FlushCompletedLines() {
            while (true) {
                var newlineIndex = this._buffer.ToString().IndexOf(Environment.NewLine, StringComparison.Ordinal);
                if (newlineIndex < 0)
                    return;

                var length = newlineIndex + Environment.NewLine.Length;
                var line = this._buffer.ToString(0, length);
                this._buffer.Remove(0, length);
                this._outputSink.WriteOutput(line);
            }
        }
    }
}
