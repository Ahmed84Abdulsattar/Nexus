## Backlog task

<!-- ID and title, e.g. S2-03 portfolio map. The PR title starts with the ID. -->

## What changed

## Acceptance check

<!-- Paste the check from docs/sprints/S#.md and say how you verified it. -->

## Definition of done (docs/14-testing-quality.md)

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass
- [ ] Docs, `db/schema.sql` and OpenAPI updated in this PR (if affected)
- [ ] No secrets, tokens or `.env` files committed
- [ ] New endpoints have `@RequirePermission` (or `@AnySignedIn` / `@Public`) and use `withProjectScope`
- [ ] Open questions written to `docs/open-questions.md`, not guessed into code
