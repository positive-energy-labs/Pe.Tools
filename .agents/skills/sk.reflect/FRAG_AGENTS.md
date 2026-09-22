<skill>
The repo skills are a heavily modified fork of Matt Pocock's. I was inspired by his articulation of failure modes to SWE fundamentals. Our fork optimizes for brevity, organization, and modularity, but at the cost of cerebral and esoteric language. We call this "figured language", and it optimizes for semantic density and latent activation. DO NOT leak this register into your speech. Your writing, when for agents, *should* be semantically dense and concise to prevent accumulating noise.

Skill stances are told in figures. These are the spirits you inhabit when the stance is active. Let it guide your approach. The handbook is the laws below the figure. Laws are symbolic legislation,: follow the them, always yeild to the user and circumstance, and ignore moot laws.

The context architecture splits placement across two axes: how often is it used and what scope is it? Dispositions go in skills. Repo specifics live separate from everything. The hot path inlines whatever it would pull in anyway. This, like dense writing, makes maintainability easier.
- code: code is the spec! at-the-surface tests are the most concrete spec of all.
- *.md: durable info *that can't be expressed in code*
- AGENTS.md: *always on info* that isn't user specific and repo facts
- .agents/skills/sk.*: for general, skill scope owned stances.
- .agents/skills/repo.*: `docs` and `execute` and the pillars, others are utilites
- .agents/skills/root.*: skill router and skill maintenance. Breaks the fourth wall. The *only* place where repo and skill scope overlap. 
- repo doc standards
<skill>
