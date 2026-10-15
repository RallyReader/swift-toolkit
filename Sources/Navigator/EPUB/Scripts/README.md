# Readium JS (Swift)

A set of JavaScript files used by the Swift EPUB navigator.

## Scripts

The package manager is pnpm (`packageManager` in `package.json`): run `corepack enable && corepack install`
(or `npx pnpm@8.15.1 …`), then `pnpm install --frozen-lockfile`, then one of the following:

* `pnpm run bundle` Rebuild the assets after any changes in the `src/` folder.
* `pnpm run checkbundle` Rebuild the assets and fail if they differ from the committed ones.
* `pnpm run lint` Check code quality.
* `pnpm run checkformat` Check if there's any formatting issues.
* `pnpm run format` Automatically format JavaScript sources.
* `pnpm test` Run the unit tests (jest + jsdom).

## Tests

`test/*.test.js` load the real modules from `src/` into an XHTML document, like the chapters the
navigator loads. They are characterization tests for the Rally Reader changes: they pin today's
behaviour, including known oddities (tests named "today: …"). Changing one of those is a behaviour
change for the app's read-aloud highlighting and needs its own commit. Layout-dependent functions
(rects, page ranges, visible words) are not covered here; jsdom has no layout.
