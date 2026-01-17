# Agents Permissions

## Purpose
Establish strict permissions for any AI agent interacting with the repo.

## Scope
Safety and authorization only. No style or philosophy.

## Allowed Read and Write Paths
- `src/` (all files and subdirectories)
- `index.html`
- `package.json`
- `vite.config.js`
- `template.json`
- `how_it_works.md`

## Explicitly Forbidden Actions
- No file deletion
- No renaming public APIs
- No dependency upgrades
- No folder restructuring
- No shell execution unless explicitly requested
- Minimal diffs only
- JSON schemas are contracts
- Refactors require explicit approval

## Outcome
All agents know exactly what they can and cannot do before touching code.