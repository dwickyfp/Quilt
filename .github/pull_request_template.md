<!--
Thanks for contributing to Quilt. Keep this short; delete any section
that does not apply.
-->

## What this changes

<!-- One or two sentences. What does the PR do, and why? -->

## Related issue

<!-- e.g. Closes #123, or Refs #123. Leave blank if none. -->

## Type

- [ ] Bug fix
- [ ] New feature (connector / transform / sink)
- [ ] Performance
- [ ] Docs
- [ ] Refactor / internal

## Checklist

- [ ] `cargo fmt` and `cargo clippy --workspace --all-targets -- -D warnings` pass
- [ ] `cargo test --workspace` passes (engine tests need `QUILT_DUCKDB_BIN` set - see CONTRIBUTING.md)
- [ ] `npm --prefix frontend run lint` passes (if the frontend changed)
- [ ] Commits are small with imperative subject lines
- [ ] No code ported from incompatibly licensed sources

## Notes for reviewers

<!-- Anything that needs context: a tradeoff you made, something you are unsure about, a follow-up you are deferring. -->
