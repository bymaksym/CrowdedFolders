/**
 * The variables CI systems set that do not always set CI: Azure Pipelines (TF_BUILD), Jenkins,
 * Buildkite, GitHub Actions, GitLab, CircleCI, TeamCity and Bitbucket Pipelines.
 */
const CI_VARIABLES = [
    'TF_BUILD',
    'JENKINS_URL',
    'BUILDKITE',
    'GITHUB_ACTIONS',
    'GITLAB_CI',
    'CIRCLECI',
    'TEAMCITY_VERSION',
    'BITBUCKET_BUILD_NUMBER',
] as const;

/**
 * The variable that says this run is in CI, as `NAME=value`, or undefined outside CI. CI comes first:
 * CI=false or CI=0 says it is not, whatever else is set.
 */
export function ciVariable(env: Readonly<Record<string, string | undefined>>): string | undefined {
    const ci = env['CI']?.trim();
    if (ci !== undefined && ci !== '') {
        const value = ci.toLowerCase();
        return value === '0' || value === 'false' ? undefined : `CI=${ci}`;
    }
    const name = CI_VARIABLES.find(variable => (env[variable]?.trim() ?? '') !== '');
    return name === undefined ? undefined : `${name}=${env[name]?.trim() ?? ''}`;
}

export function isCi(env: Readonly<Record<string, string | undefined>>): boolean {
    return ciVariable(env) !== undefined;
}
