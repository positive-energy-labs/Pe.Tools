namespace Pe.Revit.Takeoff;

internal static class PartitionRegularizer
{
    internal readonly record struct Stats(int ClaimedCells, int SharedEdgeCells, int UnclaimedInkCells);

    // Grow accepted room cores through connected wall ink only. This collapses wall thickness into
    // one deterministic shared partition without jumping across voids or swallowing rejected space.
    internal static int[] Propagate(
        int[] labels, IReadOnlySet<int> accepted, bool[] ink, int width, int height, int maxCells,
        out Stats stats)
    {
        if (labels.Length != ink.Length || labels.Length != width * height)
            throw new ArgumentException("partition grid dimensions do not match");

        var owner = new int[labels.Length];
        var distance = Enumerable.Repeat(int.MaxValue, labels.Length).ToArray();
        var queue = new Queue<int>();
        for (int cell = 0; cell < labels.Length; cell++)
            if (accepted.Contains(labels[cell])) { owner[cell] = labels[cell]; distance[cell] = 0; }

        void Claim(int from, int to)
        {
            if (!ink[to]) return;
            int nextDistance = distance[from] + 1, nextOwner = owner[from];
            if (nextDistance > maxCells
                || nextDistance > distance[to]
                || nextDistance == distance[to] && nextOwner >= owner[to]) return;
            distance[to] = nextDistance;
            owner[to] = nextOwner;
            queue.Enqueue(to);
        }

        void VisitNeighbors(int cell)
        {
            int x = cell % width, y = cell / width;
            if (x > 0) Claim(cell, cell - 1);
            if (x < width - 1) Claim(cell, cell + 1);
            if (y > 0) Claim(cell, cell - width);
            if (y < height - 1) Claim(cell, cell + width);
        }

        for (int cell = 0; cell < owner.Length; cell++)
            if (owner[cell] > 0) VisitNeighbors(cell);
        while (queue.Count > 0) VisitNeighbors(queue.Dequeue());

        int claimed = 0, shared = 0, unclaimedInk = 0;
        for (int cell = 0; cell < owner.Length; cell++)
        {
            if (owner[cell] > 0 && labels[cell] == 0) claimed++;
            if (ink[cell] && owner[cell] == 0) unclaimedInk++;
            int x = cell % width, y = cell / width;
            if (x < width - 1 && owner[cell] > 0 && owner[cell + 1] > 0 && owner[cell] != owner[cell + 1]) shared++;
            if (y < height - 1 && owner[cell] > 0 && owner[cell + width] > 0 && owner[cell] != owner[cell + width]) shared++;
        }
        stats = new Stats(claimed, shared, unclaimedInk);
        return owner;
    }
}
