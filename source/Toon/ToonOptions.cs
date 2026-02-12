namespace Toon;

public sealed record ToonOptions
{
    public static ToonOptions Default { get; } = new();

    public int IndentSize { get; init; } = 2;
    public char Delimiter { get; init; } = ',';
    public bool StrictDecoding { get; init; } = true;

    public void Validate()
    {
        if (this.IndentSize <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(this.IndentSize), "IndentSize must be positive.");
        }

        if (this.Delimiter is not (',' or '\t' or '|'))
        {
            throw new ArgumentOutOfRangeException(nameof(this.Delimiter), "Delimiter must be ',', '\\t', or '|'.");
        }
    }
}
