# docs

Source of getbauherr.dev: the site lives in `docs/site` (Zensical), deployed by `.github/workflows/site.yml`. Agent-facing docs in `docs/agents/`.

Feature list with the page of each feature: [Features](https://getbauherr.dev/features/). Releasing: [releasing.md](releasing.md). How an easy software factory looks, compared with other tools, and what Bauherr adopted: [research/easy-factory.md](research/easy-factory.md).

## Style

Every page on getbauherr.dev passes `apps/server/tests/docs-style.test.ts`:

- At most 1500 words per page. Split the page, or move the behaviour into a check, a test or the feature map.
- At most 30 words per sentence.
- At most one parenthesis per 150 words.
- No filler words; the list is `FILLER` in the test.

Write for a reader who wants to do one thing: say what it is, how to do it, where to look. The feature map says where each feature lives; pages do not repeat it.
