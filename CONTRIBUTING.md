# Contributing Guidelines

Thanks for helping improve OpenMetadata's Data Impact Action!

This guide defines the expected workflow and quality bar for production-ready contributions.

## What To Contribute

Contributions are welcome for:

- Bug fixes and regressions
- Test coverage improvements
- OpenMetadata compatibility updates
- Performance and reliability improvements
- Documentation improvements

If you plan a larger change, open an issue first so implementation approach and scope are clear before coding.

## Prerequisites

- Node.js 24+ (see `engines.node` in `package.json`)
- npm 10+
- Git

## Local Setup

```bash
npm ci
npm run check
```

`npm run check` is the full validation gate and must pass before opening or updating a PR.

## Development Workflow

1. Create a branch from `main`.
2. Keep changes focused on one problem area.
3. Add or update tests for behavior changes.
4. Run the required checks locally.
5. Open a PR with clear context and test evidence.

Recommended branch naming:

- `feat/<short-description>`
- `fix/<short-description>`
- `docs/<short-description>`
- `test/<short-description>`

## Quality Gates

Run these commands before pushing:

```bash
npm run lint
npm run typecheck
npm run test:coverage
npm run bundle:action
```

Or run everything together:

```bash
npm run check
```

### Command Reference

- `npm run lint`: ESLint for TypeScript and test files
- `npm run typecheck`: strict TypeScript checks without emit
- `npm run test`: build + Node test runner
- `npm run test:coverage`: coverage-enforced test run
- `npm run bundle:action`: build and bundle GitHub Action runtime with `ncc`

## Tests

- Add tests under `test/*.test.js`.
- Keep tests deterministic and independent.
- Prefer targeted regression tests for bug fixes.

When testing code that writes to `core.summary`, set `GITHUB_STEP_SUMMARY` to a writable temp file in the test environment.

## Action Runtime And Bundling

This repository ships a bundled JavaScript runtime for GitHub Actions:

- Action runtime entry in `action.yml`: `bundle/index.js`
- Source entry point: `src/index.ts` -> `src/action/index.ts`

If your change affects runtime behavior, regenerate and commit the bundle:

```bash
npm run bundle:action
```

Do not manually edit `bundle/index.js`.

## Documentation And Config Parity

When changing inputs, outputs, defaults, or runtime behavior, update all relevant documentation and metadata in the same PR:

- `action.yml`
- `README.md`
- Tests that enforce config/documented behavior parity

## Commit And PR Expectations

- Write clear commit messages that explain intent.
- Keep PRs reviewable in size where possible.
- Include a short "what changed" and "why" in the PR description.
- Include test evidence (commands run and key outcomes).

If behavior changes, include:

- New/updated tests
- Documentation updates
- Any migration or compatibility notes

## Security

- Never commit secrets or tokens.
- Validate endpoint handling and host restrictions when touching networking code.
- Preserve warning taxonomy and failure signaling behavior for automation safety.

If you discover a security issue, report it privately to maintainers instead of opening a public issue.

## Pull Request Checklist

- [ ] Branch is up to date with `main`
- [ ] Relevant tests were added/updated
- [ ] `npm run check` passes locally
- [ ] `bundle/index.js` regenerated and committed when runtime changed
- [ ] `action.yml` and `README.md` updated when contract changed
- [ ] No secrets or sensitive data in commits
