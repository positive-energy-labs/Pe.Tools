import { useAtom, useAtomSet, useAtomValue } from "@effect-atom/atom-react"
import { optimisticDraftsAtom, selectedFeedIdAtom, timelineAtom } from "./feedAtoms"

export function App() {
  const [feedId, setFeedId] = useAtom(selectedFeedIdAtom)
  const timeline = useAtomValue(timelineAtom)
  const setDrafts = useAtomSet(optimisticDraftsAtom)

  return <main>
    <h1>Reactive Effect Atom feed</h1>
    <select value={feedId} onChange={(event) => setFeedId(event.target.value as never)}>
      <option value="general">general</option>
      <option value="ops">ops</option>
    </select>
    <button onClick={() => setDrafts((items) => [{ id: crypto.randomUUID(), text: "optimistic item", optimistic: true }, ...items])}>
      Add optimistic item
    </button>
    <ol>{timeline.map((item) => <li key={item.id}>{item.text}{item.optimistic ? " (sending)" : ""}</li>)}</ol>
  </main>
}
