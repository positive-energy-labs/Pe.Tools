# Models

Cost: price per task. Taste: opinions, pretty code, UI/UX, architecture, decisions. Intelligence: full marks on a big but bounded and/or specified task without derailing. Bounded: a supplied edge or stop condition. Specified: the important choices supplied.

| Model | Cost | Taste | Intelligence | Use for | Notes |
|--|--|--|--|--|--|
| Fable 5 | 10 | 9 | 7 | Design, aesthetics, decisions. Only for unbounded AND unspecified work, or an important design opinion. | Low or medium thinking. Never in parallel. |
| Opus 5 | 6 | 6 | 3 | Most initial implementations, **bounded**. Talks like it is intelligent, is not; derails on the first tangent not forbidden. | Medium or high thinking. Small task, forbid going beyond it. |
| Codex (GPT-5.6) | 2 | 4 | 9 | Foot soldier: migrations, brute force, long slogs, compile smashing, censuses. Goal quantifiable AND choices specified. | Codex TOML sets model and thinking (5.6 high). Takes you at face value, no interpretation. Best for swarms and goal loops. |

Imitating intelligence is half the battle: a seemingly insightful opinion can give you a new idea, and pretty architecture is a base that only needs filling in. Different providers give different perspectives; anything below GPT-5.6 and Opus 5 is fair game for cheap perspective.

Research apostles: primary sources only (official docs, source, specs), one claim one citation, findings to `docs/research/` or the feature dir per `docs`. Clone third-party source to `.explore/` and sync before reading; grep beats the web.
