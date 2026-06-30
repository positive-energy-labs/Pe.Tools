# Upstream fetch notes

Requested upstream repositories:

- https://github.com/lucas-barake/building-an-app-with-effect
- https://github.com/Effect-TS/effect

Attempted commands:

```sh
git clone --depth 1 https://github.com/lucas-barake/building-an-app-with-effect .mastracode/skills/effect-ts/assets/building-an-app-with-effect
git clone --depth 1 https://github.com/Effect-TS/effect .mastracode/skills/effect-ts/references/effect-source
```

The container proxy returned `CONNECT tunnel failed, response 403` for `git clone` and `curl` downloads. The skill therefore bundles source-shaped excerpts and a concept index scraped from raw GitHub pages available to the browser tool. Replace `references/effect-source/src/` with a full clone when direct GitHub cloning is available.
