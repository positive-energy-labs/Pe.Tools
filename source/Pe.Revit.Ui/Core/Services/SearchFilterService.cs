using F23.StringSimilarity;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;

namespace Pe.Revit.Ui.Core.Services;

/// <summary>
///     Standard implementation of search/filter service with fuzzy matching and persistence
/// </summary>
public class SearchFilterService<TItem> where TItem : class, IPaletteListItem {
    // Typo tolerance only — applied per-word, never to full strings (see WordTypoScore)
    private readonly JaroWinkler _jaroWinkler = new();
    private readonly Func<TItem, string>? _keyGenerator;
    private readonly SearchConfig _searchConfig;
    private readonly CsvReadWriter<ItemUsageData>? _state;
    private readonly object _usageLock = new();
    private Dictionary<string, ItemUsageData> _usageCache = new();

    /// <summary>
    ///     Initializes a new instance of the <see cref="SearchFilterService{TItem}" /> class.
    /// </summary>
    public SearchFilterService(
        SearchConfig? searchConfig = null,
        ModuleStorage? storage = null,
        Func<TItem, string>? keyGenerator = null
    ) {
        this._searchConfig = searchConfig ?? SearchConfig.Default();
        this._keyGenerator = keyGenerator;
        this._state = storage?.State().Csv<ItemUsageData>();
    }

    private bool IsStorageDisabled => this._state is null || this._keyGenerator is null;

    public List<TItem> Filter(string searchText, IEnumerable<PaletteSearchSnapshot<TItem>> snapshots) {
        var snapshotList = snapshots as List<PaletteSearchSnapshot<TItem>> ?? snapshots.ToList();
        if (!snapshotList.Any()) return [];

        if (string.IsNullOrWhiteSpace(searchText)) {
            // No search text - keep most recent at top, sort rest by used date then usage count
            var ordered = snapshotList
                .OrderByDescending(s => this.GetLastUsedDate(s.UsageKey))
                .ThenByDescending(s => this.GetUsageCount(s.UsageKey))
                .Select(s => s.Item)
                .ToList();

            return [ordered.First(), .. ordered.Skip(1).ToList()];
        }

        var searchTokens = searchText.Trim().ToLowerInvariant()
            .Split([' '], StringSplitOptions.RemoveEmptyEntries);

        // Frecency is blended into the score (not a tiebreaker): a daily-driver item
        // with a decent match outranks a never-used item with a slightly better one.
        return snapshotList
            .Select(s => (item: s.Item, score: this.CalculateItemSearchScore(s, searchTokens), s.UsageKey))
            .Where(x => x.score > 0)
            .Select(x => (x.item, score: x.score + this.FrecencyBoost(x.UsageKey), x.UsageKey))
            .OrderByDescending(x => x.score)
            .ThenByDescending(x => this.GetUsageCount(x.UsageKey))
            .ThenByDescending(x => this.GetLastUsedDate(x.UsageKey))
            .Select(x => x.item)
            .ToList();
    }

    /// <summary>
    ///     Usage-derived score bonus (0-60): log-scaled use count (max 40) + recency bucket (max 20).
    ///     Additive so it reorders near-ties without letting a popular item hijack a bad match.
    /// </summary>
    private double FrecencyBoost(string? key) {
        if (string.IsNullOrWhiteSpace(key)) return 0;
        ItemUsageData? usage;
        lock (this._usageLock)
            usage = this._usageCache.GetValueOrDefault(key);
        if (usage == null || usage.UsageCount <= 0) return 0;

        var countBoost = Math.Min(40.0, Math.Log(usage.UsageCount + 1, 2) * 8);
        var days = (DateTime.Now - usage.LastUsed).TotalDays;
        var recencyBoost = days switch { < 1 => 20.0, < 7 => 12.0, < 30 => 6.0, _ => 0.0 };
        return countBoost + recencyBoost;
    }

    public void RecordUsage(TItem item) {
        if (this.IsStorageDisabled) return;
        var key = this._keyGenerator!(item);
        if (string.IsNullOrWhiteSpace(key)) return;
        ItemUsageData? existing;
        lock (this._usageLock)
            existing = this._usageCache.GetValueOrDefault(key);
        var usageCount = (existing?.UsageCount ?? 0) + 1;

        var usageData = new ItemUsageData { ItemKey = key, UsageCount = usageCount, LastUsed = DateTime.Now };
        var state = this._state;
        if (state == null)
            return;

        _ = state.WriteRow(key, usageData);
        lock (this._usageLock)
            this._usageCache[key] = usageData;
    }

    public void LoadUsageData() {
        if (this.IsStorageDisabled) return;
        var state = this._state;
        if (state == null)
            return;

        lock (this._usageLock)
            this._usageCache = state.Read();
    }

    /// <summary>
    ///     Builds searchable metadata for a single item.
    /// </summary>
    public SearchableItemMetadata BuildMetadata(TItem item) {
        // Only evaluate TextInfo if it's actually needed for search
        var infoText = this._searchConfig?.SearchFields.HasFlag(SearchFields.TextInfo) == true
            ? item.GetTextInfo?.Invoke() ?? string.Empty
            : string.Empty;

        var allText = this._searchConfig?.SearchFields.HasFlag(SearchFields.TextInfo) == true
            ? $"{item.TextPrimary} {item.TextSecondary} {item.TextPill} {infoText}"
            : $"{item.TextPrimary} {item.TextSecondary} {item.TextPill}";

        return new SearchableItemMetadata {
            PrimaryLower = (item.TextPrimary ?? string.Empty).ToLowerInvariant(),
            SecondaryLower = (item.TextSecondary ?? string.Empty).ToLowerInvariant(),
            PillLower = (item.TextPill ?? string.Empty).ToLowerInvariant(),
            InfoLower = infoText.ToLowerInvariant(),
            PrimaryWords = SplitIntoWords(item.TextPrimary ?? string.Empty),
            PrimaryAcronym = BuildAcronym(item.TextPrimary ?? string.Empty),
            AllWords = SplitIntoWords(allText)
        };
    }

    // '.' matters for Revit content naming conventions ("A.O.Smith_Voltex_...")
    private static readonly char[] WordSeparators = [' ', '-', '_', '.', '/', '('];

    private static string[] SplitIntoWords(string text) {
        if (string.IsNullOrEmpty(text)) return [];

        return text.Split(WordSeparators, StringSplitOptions.RemoveEmptyEntries)
            .Select(w => w.ToLowerInvariant())
            .ToArray();
    }

    private static string BuildAcronym(string text) {
        if (string.IsNullOrEmpty(text)) return string.Empty;

        var words = text.Split(WordSeparators, StringSplitOptions.RemoveEmptyEntries);
        return string.Concat(words.Select(w => w.Length > 0 ? char.ToLower(w[0]) : ' '));
    }

    internal string? GetUsageKey(TItem item) {
        if (this.IsStorageDisabled) return null;
        var key = this._keyGenerator!(item);
        return string.IsNullOrWhiteSpace(key) ? null : key;
    }

    private int GetUsageCount(string? key) {
        if (this.IsStorageDisabled) return 0;
        if (string.IsNullOrWhiteSpace(key)) return 0;
        lock (this._usageLock)
            return this._usageCache.GetValueOrDefault(key)?.UsageCount ?? 0;
    }

    private DateTime GetLastUsedDate(string? key) {
        if (this.IsStorageDisabled) return DateTime.MinValue;
        if (string.IsNullOrWhiteSpace(key)) return DateTime.MinValue;
        ItemUsageData? usageData;
        lock (this._usageLock)
            usageData = this._usageCache.GetValueOrDefault(key);
        return usageData?.LastUsed.Date ?? DateTime.MinValue;
    }

    /// <summary>
    ///     Scores an item against all search tokens. Every token must match somewhere
    ///     (best field wins per token); the item score is the mean token score, so
    ///     adding a refining word never demotes the item it was meant to find.
    /// </summary>
    private double CalculateItemSearchScore(PaletteSearchSnapshot<TItem> snapshot, string[] searchTokens) {
        if (searchTokens.Length == 0) return 0;
        var metadata = snapshot.Metadata;

        var fields = this._searchConfig.SearchFields;
        var weights = this._searchConfig.FieldWeights;

        // Collect all searchable field texts with their weights (using cached lowercase strings)
        var fieldTexts = new List<(string text, double weight)>();

        if (fields.HasFlag(SearchFields.TextPrimary) && !string.IsNullOrEmpty(metadata.PrimaryLower))
            fieldTexts.Add((metadata.PrimaryLower, weights.Primary));

        if (fields.HasFlag(SearchFields.TextSecondary) && !string.IsNullOrEmpty(metadata.SecondaryLower))
            fieldTexts.Add((metadata.SecondaryLower, weights.Secondary));

        if (fields.HasFlag(SearchFields.TextPill) && !string.IsNullOrEmpty(metadata.PillLower))
            fieldTexts.Add((metadata.PillLower, weights.Pill));

        if (fields.HasFlag(SearchFields.TextInfo) && !string.IsNullOrEmpty(metadata.InfoLower))
            fieldTexts.Add((metadata.InfoLower, weights.Info));

        if (fieldTexts.Count == 0) return 0;

        var total = 0.0;
        foreach (var token in searchTokens) {
            var best = 0.0;
            foreach (var (text, weight) in fieldTexts)
                best = Math.Max(best, this.ScoreToken(text, token, metadata) * weight);

            // Fuzzy fallbacks run on primary + secondary — never pill/info, where
            // subsequence hits in long text are noise, not intent.
            if (best < 70 * weights.Primary) {
                var fuzzy = 0.0;
                if (!string.IsNullOrEmpty(metadata.PrimaryLower)) {
                    fuzzy = Math.Max(
                        SubsequenceScore(metadata.PrimaryLower, token),
                        this.WordTypoScore(metadata.PrimaryWords, token)) * weights.Primary;
                }

                if (fields.HasFlag(SearchFields.TextSecondary) && !string.IsNullOrEmpty(metadata.SecondaryLower))
                    fuzzy = Math.Max(fuzzy, SubsequenceScore(metadata.SecondaryLower, token) * weights.Secondary);

                best = Math.Max(best, fuzzy);
            }

            if (best <= 0) return 0; // every token must land somewhere
            total += best;
        }

        var score = total / searchTokens.Length;

        // Apply custom score adjuster if provided
        if (this._searchConfig.CustomScoreAdjuster != null && score > 0)
            score = this._searchConfig.CustomScoreAdjuster(snapshot.Item, score);

        return score;
    }

    /// <summary>
    ///     Exact-ish match ladder for one token against one field (0-200).
    /// </summary>
    private double ScoreToken(string text, string token, SearchableItemMetadata metadata) {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(token)) return 0;

        if (text == token) return 200;
        if (text.StartsWith(token)) return 150;
        // Acronym (e.g. "mfp" -> "Mechanical Floor Plan"); metadata acronym is primary-only,
        // so this only fires when scoring the primary field.
        if (ReferenceEquals(text, metadata.PrimaryLower) && this.IsAcronymMatch(metadata, token)) return 120;
        if (this.IsWordBoundaryMatch(text, token)) return 110;
        if (text.Contains(token)) return 90;
        return 0;
    }

    /// <summary>
    ///     fzf-style in-order subsequence match (0-85): "mecfl" hits "mechanical floor plan".
    ///     Greedy left-to-right; bonuses for word-boundary and consecutive hits, penalty for a
    ///     late first hit. ponytail: greedy, not the fzf DP — upgrade if ranking feels off.
    /// </summary>
    private static double SubsequenceScore(string text, string token) {
        if (token.Length < 2 || token.Length > text.Length) return 0;

        var qi = 0;
        var bonus = 0.0;
        var firstHit = -1;
        var prevHit = false;
        for (var ti = 0; ti < text.Length && qi < token.Length; ti++) {
            if (text[ti] != token[qi]) {
                prevHit = false;
                continue;
            }

            if (firstHit < 0) firstHit = ti;
            var atBoundary = ti == 0 || WordSeparators.Contains(text[ti - 1]);
            bonus += atBoundary ? 8 : prevHit ? 5 : 1;
            prevHit = true;
            qi++;
        }

        if (qi < token.Length) return 0; // not all chars found in order

        // Normalize: all-boundary hits = 8/char is the ceiling.
        var quality = bonus / (token.Length * 8.0);
        var startPenalty = Math.Min(firstHit, 10);
        return Math.Max(10, (30 + (55 * quality)) - startPenalty);
    }

    /// <summary>
    ///     Typo tolerance (0-70): best JaroWinkler over individual primary words, so
    ///     "shedule" still finds "Schedule" without full-string similarity noise.
    /// </summary>
    private double WordTypoScore(string[] words, string token) {
        if (token.Length < 3 || words.Length == 0) return 0;

        var threshold = Math.Max(0.85, this._searchConfig.MinFuzzyScore);
        var best = 0.0;
        foreach (var word in words) {
            var sim = this._jaroWinkler.Similarity(word, token);
            if (sim >= threshold) best = Math.Max(best, sim * 70);
        }

        return best;
    }

    /// <summary>
    ///     Checks if search string matches the acronym of the text (using cached acronym)
    ///     Example: "wfs" matches "Wall Foundation Section"
    /// </summary>
    private bool IsAcronymMatch(SearchableItemMetadata metadata, string search) {
        if (search.Length < 2) return false;
        if (string.IsNullOrEmpty(metadata.PrimaryAcronym)) return false;
        if (metadata.PrimaryWords.Length < search.Length) return false;

        return metadata.PrimaryAcronym.StartsWith(search);
    }

    /// <summary>
    ///     Checks if search string matches at word boundaries
    ///     Example: "wall" matches "Wall Section" better than "Drywall"
    /// </summary>
    private bool IsWordBoundaryMatch(string text, string search) {
        if (search.Length < 2) return false;

        var index = text.IndexOf(search, StringComparison.Ordinal);
        if (index < 0) return false;

        // Match at start is always a word boundary
        if (index == 0) return true;

        // Check if character before match is a separator
        return WordSeparators.Contains(text[index - 1]);
    }
}