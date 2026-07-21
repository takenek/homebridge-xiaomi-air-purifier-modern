# Release checklist

- [ ] `npm ci`
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test` (coverage thresholds are 100% lines/functions/branches/statements)
- [ ] `npm run build`
- [ ] `npm pack --dry-run` and verify package contents
- [ ] Review `CHANGELOG.md`
- [ ] Publish flow: semantic-release workflow on `main` (preferred) or emergency manual tag release

## Release pipeline hardening (A-02)

The `release.yml` workflow is split into two jobs:

- **`verify`** — read-only (`contents: read`, no OIDC), runs `npm ci`,
  `npm audit --audit-level=high` and `npm run check` across the full Node 22/24
  matrix for the exact commit being released.
- **`publish`** — gains write/OIDC scopes only after `verify` succeeds
  (`needs: [verify]`), checks out with `persist-credentials: false`, and runs
  semantic-release (npm Trusted Publishing via OIDC).

Operator prerequisites (configured outside the repository, in GitHub settings):

- [ ] Create a protected **`release` Environment** and add required reviewers
      and/or required status checks (CI, Supply Chain) so publication is gated by
      branch-protection outcomes for the same commit.
- [ ] Enable branch protection on `main` with required status checks (CI,
      Supply Chain, Scorecard) and required reviews.
- [ ] Confirm the npm **Trusted Publisher** configuration for this package.
- [ ] Residual: pin the semantic-release tool tree deterministically (exact core
      version + locked plugins, or an immutable release image) — see
      `STAGE_5_REMEDIATION_IMPLEMENTATION.md` §5 (A-02).
