# ICARUS Talent Calculator

## Icarus static roots

This app uses two static roots:

- `public/Exports` for a copied subset of game-owned files used at runtime
- `public/Data` for app-owned transformed data (`talents.json`)

Regenerate both from `talent-transform` (optionally pointing at an external exports folder):

```bash
cd ../talent-transform
npm run transform -- --game-export /path/to/Exports
```

## Transformed contract (minimal v3)

`public/Data/talents.json` now uses a minimal transform contract (`schemaVersion: 3`):

- Keeps structural joins (`models -> archetypes -> trees -> talents`) for UI/runtime link stability.
- Preserves source-like values for text fields (`display`, `description`) as raw strings, including `NSLOCTEXT(...)` strings.
- Keeps reward effects as raw pairs (`rawKey`, `value`) without synthesized localization key fields.

The UI derives localization keys and display text at runtime.

## Path preflight

A path preflight runs automatically before `dev`, `build`, and `preview` to verify required Exports/Data paths.

Run it manually:

```bash
npm run check:paths
```

If preflight fails, regenerate `public/Data/talents.json` and the copied `public/Exports` subset from `talent-transform`.

Then run/build as usual:

```bash
npm run dev
npm run build
```

## Shared build URLs

The app supports self-contained share links using a single query parameter:

- `?build=<payload>`

The payload is a Base64URL-encoded JSON object containing:

- `cv`: share codec version
- `sv`: transformed data schema version (`talents.json`)
- `m`: model id (`Player` or `Creature`)
- `a`: archetype id
- `t`: skilled talents map
- `n`: optional build title metadata
- `d`: optional build description metadata

When a shared URL is opened:

- The build is loaded and activated immediately.
- As build state changes (for example, talent clicks), the `build` URL parameter is re-encoded in place.
- Validation warnings are shown for codec/schema mismatches and missing prerequisites.
- Shared title/description metadata pre-fills the Save dialog but is not auto-saved.
- Current title/description metadata is tracked per active subject (Player and each Creature archetype) and persists across context switches and page reloads.
- Saving a build with an existing title prompts for overwrite confirmation and, if confirmed, updates that existing saved build.
