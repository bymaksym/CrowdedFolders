/**
 * `npm-check-updates` configuration (`pnpm run deps:check` / `pnpm run deps:update`).
 *
 * Every dependency here is a development dependency — the published package has none — so an
 * update never reaches someone who ran `npx crowded-folders`. Dependabot brings the minors and
 * patches once a month; this is where a major is looked at on purpose.
 *
 * What cannot move a major is held to its current one, and said why, the same as in
 * .github/dependabot.yml: proposing it is noise, because it cannot be accepted without breaking the
 * build. Everything else is proposed in full — the report has to stay actionable, not hide work.
 */

/**
 * Held to patches:
 *   `typescript`   → typescript-eslint declares `typescript: ">=4.8.4 <6.1.0"`: not only the next
 *                    major (the native compiler, 7) is out, also the next minor.
 *   `@types/node`  → follows the oldest Node in "engines" (20.19): a newer one types APIs that
 *                    Node 20.19 does not have, which pass the type check and fail on the floor job.
 */
const PATCH_ONLY = new Set(['typescript', '@types/node']);

/** @type {import('npm-check-updates').RcOptions} */
export default {
    /**
     * Quarantine for freshly published versions: nothing published in the last three days is
     * proposed. That is the window in which a compromised release gets spotted and unpublished.
     * It only covers what ncu proposes, the DIRECT dependencies: the same quarantine for transitive
     * ones is `minimumReleaseAge` in pnpm-workspace.yaml, and the two numbers are meant to agree.
     */
    cooldown: '3d',

    /** `time` dates each proposal and `cooldown` shows what the quarantine held back. */
    format: ['group', 'time', 'cooldown'],

    target: name => (PATCH_ONLY.has(name) ? 'patch' : 'latest'),
};
