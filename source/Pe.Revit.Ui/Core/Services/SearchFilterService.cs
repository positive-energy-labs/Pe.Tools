using F23.StringSimilarity;
using Pe.Revit.Global.PolyFill;
using Pe.StorageRuntime.Json;
using Pe.StorageRuntime;

namespace Pe.Ui.Core.Services;

/// <summary>
///     Standard implementation of search/filter service with fuzzy matching and persistence
/// </summary>
public class SearchFilterService<TItem> where TItem : class, IPaletteListItem {
    private readonly Cosine _cosine = new(2); // 2-gram for cosine similarity

    // String similarity algorithms
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

        var searchLower = searchText.ToLowerInvariant();

        // Use LINQ for cleaner, more functional approach
        return snapshotList
            .Select(s => (item: s.Item, score: this.CalculateItemSearchScore(s, searchLower), s.UsageKey))
            .Where(x => x.score > 0)
            .OrderByDescending(x => x.score)
            .ThenByDescending(x => this.GetUsageCount(x.UsageKey))
            .ThenByDescending(x => this.GetLastUsedDate(x.UsageKey))
            .Select(x => x.item)
            .ToList();
    }

    public void RecordUsage(TItem item) {
        if (this.IsStorageDisabled) return;
        var key = this._keyGenerator!(item);
        if (string.IsNullOrWhiteSpace(key)) return;
        ItemUsageData existing;
        lock (this._usageLock)
            existing = this._usageCache.GetValueOrDefault(key);
        var usageCount = (existing?.UsageCount ?? 0) + 1;

        var usageData = new ItemUsageData { ItemKey = key, UsageCount = usageCount, LastUsed = DateTime.Now };

        _ = this._state.WriteRow(key, usageData);
        lock (this._usageLock)
            this._usageCache[key] = usageData;
    }

    public void LoadUsageData() {
        if (this.IsStorageDisabled) return;

        lock (this._usageLock)
            this._usageCache = this._state!.Read();
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

    private static string[] SplitIntoWords(string text) {
        if (string.IsNullOrEmpty(text)) return [];

        return text.Split([' ', '-', '_'], StringSplitOptions.RemoveEmptyEntries)
            .Select(w => w.ToLowerInvariant())
            .ToArray();
    }

    private static string BuildAcronym(string text) {
        if (string.IsNullOrEmpty(text)) return string.Empty;

        var words = text.Split([' ', '-', '_'], StringSplitOptions.RemoveEmptyEntries);
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
    ///     Calculates search score for an item across all configured fields
    /// </summary>
    private double CalculateItemSearchScore(PaletteSearchSnapshot<TItem> snapshot, string searchLower) {
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

        // Check if this is a multi-token search
        var searchTokens = searchLower.Split([' '], StringSplitOptions.RemoveEmptyEntries);

        if (searchTokens.Length > 1) {
            // Multi-token search: try to match tokens across different fields
            var crossFieldScore = this.CalculateCrossFieldScore(fieldTexts, searchTokens);
            if (crossFieldScore > 0) return crossFieldScore;
        }

        // Single token or fallback: find the best score from any single field
        var maxScore = 0.0;
        foreach (var (text, weight) in fieldTexts) {
            var score = this.CalculateSearchScore(text, searchLower, metadata) * weight;
            maxScore = Math.Max(maxScore, score);
        }

        // Apply custom score adjuster if provided
        if (this._searchConfig.CustomScoreAdjuster != null && maxScore > 0)
            maxScore = this._searchConfig.CustomScoreAdjuster(snapshot.Item, maxScore);

        return maxScore;
    }

    /// <summary>
    ///     Calculates score when search tokens can match across different fields
    ///     Example: "pyrevit settings" can match "pyrevit" in Secondary and "settings" in Primary
    /// </summary>
    private double CalculateCrossFieldScore(List<(string text, double weight)> fieldTexts, string[] searchTokens) {
        // Try to match each token to the best field
        var totalScore = 0.0;
        var matchedTokens = 0;

        foreach (var token in searchTokens) {
            var bestTokenScore = 0.0;

            foreach (var (text, weight) in fieldTexts) {
                var tokenScore = 0.0;

                if (this.IsWordBoundaryMatch(text, token))
                    tokenScore = 80;
                else if (text.StartsWith(token))
                    tokenScore = 70;
                else if (text.Contains(token))
                    tokenScore = 50;

                if (tokenScore > 0) bestTokenScore = Math.Max(bestTokenScore, tokenScore * weight);
            }

            if (bestTokenScore > 0) {
                totalScore += bestTokenScore;
                matchedTokens++;
            }
        }

        // All tokens must match somewhere
        if (matchedTokens != searchTokens.Length) return 0;

        // Apply penalty for multi-token search (0.8x)
        return totalScore * 0.8;
    }

    /// <summary>
    ///     Calculates search relevance score using String.Similarity algorithms
    ///     Uses JaroWinkler for primary scoring (designed for short strings and typos)
    ///     Combined with exact/prefix matching for better UX
    /// </summary>
    private double CalculateSearchScore(string text, string search, SearchableItemMetadata metadata) {
        if (string.IsNullOrEmpty(text) || string.IsNullOrEmpty(search))
            return 0;

        var baseScore = 0.0;

        // Exact match - highest priority
        if (text == search) return 200;

        // Prefix match - very high priority for type-ahead
        if (text.StartsWith(search)) baseScore += 150;

        // Contains match - high priority for substring matching
        if (text.Contains(search)) baseScore = Math.Max(baseScore, 100);

        // Acronym match (e.g., "wfs" matches "Wall Foundation Section")
        if (this.IsAcronymMatch(metadata, search))
            baseScore = Math.Max(baseScore, 80);

        // Word boundary match (e.g., "wall" prefers "Wall Section" over "Drywall")
        if (this.IsWordBoundaryMatch(text, search))
            baseScore = Math.Max(baseScore, 70);

        // JaroWinkler similarity - excellent for typos and short strings
        // Returns value between 0.0 and 1.0, scale to 0-100
        var jaroScore = this._jaroWinkler.Similarity(text, search) * 100;

        // Only use JaroWinkler if it's above threshold (0.7 = 70 score)
        if (jaroScore >= 70) baseScore = Math.Max(baseScore, jaroScore);

        // For longer strings, also try Cosine similarity (good for partial matches)
        if (search.Length >= 3 && text.Length >= 3) {
            var cosineScore = this._cosine.Similarity(text, search) * 100;
            if (cosineScore >= 50) {
                // Cosine gets lower weight, but can help with partial matches
                baseScore = Math.Max(baseScore, cosineScore * 0.7);
            }
        }

        return baseScore;
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
        var charBefore = text[index - 1];
        return charBefore is ' ' or '-' or '_';
    }
}
