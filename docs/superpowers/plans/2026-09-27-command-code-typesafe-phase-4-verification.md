# Phase 4: Full Verification and Package Inspection

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this phase. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the phased implementation is complete, scoped, and packageable.

**Depends on:** Phases 1–3 are complete and committed.

**Usable result:** A verified npm package dry-run suitable for release review.

## Steps

- [ ] Run `pnpm check`; fix only failures caused by the implementation.
- [ ] Run `pnpm pack:dry-run`; confirm the new runtime provider, README, and changelog are included.
- [ ] Review the final diff for unchanged existing provider behavior, no credentials in errors, no accidental System One ZDR header, no unrequested dependency, and no version bump.
- [ ] Record the verification commands and results in the implementation handoff.

