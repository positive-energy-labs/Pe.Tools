namespace Pe.Revit.Takeoff;

internal static class PartitionRegularizer
{
    internal readonly record struct Stats(
        int ClaimedCells, int SharedEdgeCells, int UnclaimedInkCells, int ResolvedEnclosedCells);

    // Grow accepted room cores through connected wall ink only. This collapses wall thickness into
    // one deterministic shared partition without jumping across voids or swallowing rejected space.
    internal static int[] Propagate(
        int[] labels, ISet<int> accepted, bool[] ink, int width, int height, int maxCells,
        int maxEnclosedCells,
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

        int resolvedEnclosed = ResolveEnclosed(owner, width, height, maxEnclosedCells);

        int claimed = 0, shared = 0, unclaimedInk = 0;
        for (int cell = 0; cell < owner.Length; cell++)
        {
            if (owner[cell] > 0 && labels[cell] == 0) claimed++;
            if (ink[cell] && owner[cell] == 0) unclaimedInk++;
            int x = cell % width, y = cell / width;
            if (x < width - 1 && owner[cell] > 0 && owner[cell + 1] > 0 && owner[cell] != owner[cell + 1]) shared++;
            if (y < height - 1 && owner[cell] > 0 && owner[cell + width] > 0 && owner[cell] != owner[cell + width]) shared++;
        }
        stats = new Stats(claimed, shared, unclaimedInk, resolvedEnclosed);
        return owner;
    }

    private static int ResolveEnclosed(int[] owner, int width, int height, int maxCells)
    {
        if (maxCells <= 0) return 0;
        var seen = new bool[owner.Length];
        int resolved = 0;

        for (int start = 0; start < owner.Length; start++)
        {
            if (owner[start] != 0 || seen[start]) continue;
            var component = new List<int>();
            var queue = new Queue<int>();
            bool touchesBorder = false;
            seen[start] = true;
            queue.Enqueue(start);
            while (queue.Count > 0)
            {
                int cell = queue.Dequeue(), x = cell % width, y = cell / width;
                component.Add(cell);
                touchesBorder |= x == 0 || y == 0 || x == width - 1 || y == height - 1;
                Visit(cell - 1, x > 0); Visit(cell + 1, x < width - 1);
                Visit(cell - width, y > 0); Visit(cell + width, y < height - 1);
            }
            if (touchesBorder || component.Count > maxCells) continue;

            var componentSet = component.ToHashSet();
            var distance = component.ToDictionary(cell => cell, _ => int.MaxValue);
            var resolvedOwner = component.ToDictionary(cell => cell, _ => 0);
            var frontier = new Queue<int>();
            foreach (int cell in component)
            {
                int x = cell % width, y = cell / width;
                Seed(cell, x > 0 ? owner[cell - 1] : 0);
                Seed(cell, x < width - 1 ? owner[cell + 1] : 0);
                Seed(cell, y > 0 ? owner[cell - width] : 0);
                Seed(cell, y < height - 1 ? owner[cell + width] : 0);
            }
            while (frontier.Count > 0)
            {
                int cell = frontier.Dequeue(), x = cell % width, y = cell / width;
                Grow(cell, cell - 1, x > 0); Grow(cell, cell + 1, x < width - 1);
                Grow(cell, cell - width, y > 0); Grow(cell, cell + width, y < height - 1);
            }
            if (resolvedOwner.Values.Any(value => value == 0)) continue;
            foreach (int cell in component) owner[cell] = resolvedOwner[cell];
            resolved += component.Count;

            void Seed(int cell, int candidate)
            {
                if (candidate <= 0 || distance[cell] < 1
                    || distance[cell] == 1 && resolvedOwner[cell] <= candidate) return;
                distance[cell] = 1;
                resolvedOwner[cell] = candidate;
                frontier.Enqueue(cell);
            }

            void Grow(int from, int to, bool valid)
            {
                if (!valid || !componentSet.Contains(to)) return;
                int nextDistance = distance[from] + 1, candidate = resolvedOwner[from];
                if (candidate <= 0 || nextDistance > distance[to]
                    || nextDistance == distance[to] && candidate >= resolvedOwner[to]) return;
                distance[to] = nextDistance;
                resolvedOwner[to] = candidate;
                frontier.Enqueue(to);
            }

            void Visit(int cell, bool valid)
            {
                if (!valid || seen[cell] || owner[cell] != 0) return;
                seen[cell] = true;
                queue.Enqueue(cell);
            }
        }
        return resolved;
    }
}
