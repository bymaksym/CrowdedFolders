type Obj = Record<string, unknown>;

/**
 * What GitHub code scanning requires of a SARIF file, beyond what the SARIF 2.1.0 schema says. It is
 * written out rule by rule so that a failure names the rule that broke (see "SARIF support for code
 * scanning" in GitHub's documentation). It returns the violations; an empty list means GitHub would
 * take the file.
 */
export function sarifViolations(value: unknown): string[] {
    const problems: string[] = [];
    const sarif = value as Obj;
    if (sarif['version'] !== '2.1.0') problems.push('version must be "2.1.0"');
    const runs = sarif['runs'];
    if (!Array.isArray(runs) || runs.length === 0 || runs.length > 20) {
        return [...problems, 'runs must hold between 1 and 20 runs'];
    }
    for (const [runIndex, run] of (runs as Obj[]).entries()) {
        checkRun(run, `runs[${runIndex}]`, problems);
    }
    return problems;
}

function checkRun(run: Obj, at: string, problems: string[]): void {
    const driver = ((run['tool'] as Obj | undefined)?.['driver'] ?? {}) as Obj;
    if (typeof driver['name'] !== 'string' || driver['name'] === '') {
        problems.push(`${at}.tool.driver.name is required`);
    }
    const rules = (driver['rules'] ?? []) as Obj[];
    const ids = new Set<string>();
    for (const [index, rule] of rules.entries()) {
        checkRule(rule, `${at} rule ${index}`, ids, problems);
    }
    const results = (run['results'] ?? []) as Obj[];
    if (results.length > 25_000) problems.push(`${at} has more than 25,000 results`);
    const seen = new Set<string>();
    for (const [index, result] of results.entries()) {
        checkResult(result, `${at}.results[${index}]`, rules, ids, seen, problems);
    }
    for (const invocation of (run['invocations'] ?? []) as Obj[]) {
        if (typeof invocation['executionSuccessful'] !== 'boolean') {
            problems.push(`${at}.invocations: executionSuccessful must be a boolean`);
        }
    }
}

function checkRule(rule: Obj, at: string, ids: Set<string>, problems: string[]): void {
    const id = rule['id'];
    if (typeof id !== 'string' || id === '') problems.push(`${at} has no id`);
    else if (ids.has(id)) problems.push(`${at}: ${id} is declared twice`);
    else ids.add(id);
    const short = (rule['shortDescription'] as { text?: unknown } | undefined)?.text;
    if (typeof short !== 'string' || short === '') problems.push(`${at} needs shortDescription.text`);
    else if (short.length > 1024) problems.push(`${at}: shortDescription.text is over 1024 characters`);
    else if (short.includes('`')) problems.push(`${at}: shortDescription.text is plain text, with no backticks`);
    const help = rule['help'] as { text?: unknown; markdown?: unknown } | undefined;
    if (typeof help?.text !== 'string' || typeof help.markdown !== 'string') {
        problems.push(`${at} needs help.text and help.markdown`);
    }
}

function checkResult(
    result: Obj,
    where: string,
    rules: readonly Obj[],
    ids: ReadonlySet<string>,
    seen: Set<string>,
    problems: string[],
): void {
    const ruleId = result['ruleId'];
    if (typeof ruleId !== 'string' || !ids.has(ruleId)) {
        problems.push(`${where}: ruleId ${String(ruleId)} has no descriptor in driver.rules`);
    }
    const ruleIndex = result['ruleIndex'];
    if (!Number.isSafeInteger(ruleIndex) || rules[ruleIndex as number]?.['id'] !== ruleId) {
        problems.push(`${where}: ruleIndex does not point at the descriptor of ${String(ruleId)}`);
    }
    if (!['error', 'warning', 'note', 'none'].includes(String(result['level']))) {
        problems.push(`${where}: level is not valid`);
    }
    const text = (result['message'] as { text?: unknown } | undefined)?.text;
    if (typeof text !== 'string' || text === '') problems.push(`${where}: message.text is required`);
    else if (/\p{Cc}/u.test(text)) problems.push(`${where}: message.text has a control character`);

    const locations = result['locations'];
    if (!Array.isArray(locations) || locations.length === 0 || locations.length > 10) {
        problems.push(`${where}: needs between 1 and 10 locations`);
    } else {
        for (const location of locations as Record<string, Record<string, Obj>>[]) {
            const physical = location['physicalLocation'];
            const uri = physical?.['artifactLocation']?.['uri'];
            if (typeof uri !== 'string' || uri === '' || uri === '.') {
                problems.push(`${where}: a location needs the uri of a file`);
            } else if (/^(?:[a-z][a-z0-9+.-]*:|\/)/iu.test(uri) || uri.split('/').includes('..')) {
                problems.push(`${where}: uri ${uri} must be relative to the repository`);
            }
            const startLine = physical?.['region']?.['startLine'];
            if (!Number.isSafeInteger(startLine) || (startLine as number) < 1) {
                problems.push(`${where}: region.startLine must be 1 or more`);
            }
        }
    }

    const fingerprints = result['partialFingerprints'] as Obj | undefined;
    const entries = Object.entries(fingerprints ?? {});
    if (entries.length === 0 || entries.some(([, v]) => typeof v !== 'string' || v === '' || v.length > 256)) {
        problems.push(`${where}: partialFingerprints must be non-empty strings`);
    }
    const identity = `${String(ruleId)}|${JSON.stringify(fingerprints)}`;
    if (seen.has(identity)) problems.push(`${where}: two results of ${String(ruleId)} share a fingerprint`);
    seen.add(identity);
}
