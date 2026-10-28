import type { Severity } from '../rules/rule.ts';
import type {
    Config,
    NamingConfig,
    NamingState,
    OverrideConfig,
    OverrideState,
    ResolvedConfig,
    RuleSetting,
    RuleState,
} from './types.ts';

/**
 * Lays one configuration over what was resolved so far. `extends` has already been applied by the
 * caller, in order, before this layer.
 *
 * - Lists accumulate; `"!x"` removes `x` from what was inherited.
 * - A rule set to a bare severity keeps its options; `[severity, options]` merges the options in,
 *   lists inside them accumulating the same way.
 * - Overrides are kept in order and applied per folder later.
 */
export function mergeLayer(base: ResolvedConfig, layer: Config, origin: string, own: boolean): ResolvedConfig {
    const rules: Record<string, RuleState> = { ...base.rules };
    for (const [name, setting] of Object.entries(layer.rules ?? {})) {
        rules[name] = applySetting(rules[name], setting);
    }
    const overrides: OverrideState[] = [
        ...base.overrides,
        ...(layer.overrides ?? []).map(override => overrideState(override, origin, own)),
    ];
    return {
        include: mergeList(base.include, layer.include),
        exclude: mergeList(base.exclude, layer.exclude),
        naming: mergeNaming(base.naming, layer.naming),
        rules,
        overrides,
        layers: [...base.layers, origin],
        suppressions: layer.suppressions ?? base.suppressions,
    };
}

/**
 * An override as the engine reads it. Its `extends` is not here: the loader applies those presets
 * to its folders before it, as overrides of their own.
 */
export function overrideState(
    override: Pick<
        OverrideConfig,
        'expires' | 'folders' | 'naming' | 'owner' | 'reason' | 'rules' | 'ticket' | 'withFiles'
    >,
    origin: string,
    own: boolean,
): OverrideState {
    return {
        folders: override.folders,
        withFiles: override.withFiles ?? [],
        reason: override.reason.trim(),
        expires: override.expires,
        owner: override.owner,
        ticket: override.ticket,
        rules: override.rules ?? {},
        naming: override.naming ?? {},
        origin,
        own,
        within: [],
    };
}

export function mergeNaming(base: NamingState, layer: NamingConfig | undefined): NamingState {
    if (!layer) {
        return base;
    }
    return {
        companions: mergeList(base.companions, layer.companions),
        ignoreLeadingWords: mergeList(
            base.ignoreLeadingWords,
            layer.ignoreLeadingWords?.map(word => word.toLowerCase()),
        ),
        groupNumericPrefixes: layer.groupNumericPrefixes ?? base.groupNumericPrefixes,
        folderFiles: mergeList(base.folderFiles, layer.folderFiles),
        folderCompanions: mergeList(base.folderCompanions, layer.folderCompanions),
    };
}

export function applySetting(current: RuleState | undefined, setting: RuleSetting): RuleState {
    const previous = current ?? { severity: 'off' as Severity, options: {} };
    if (typeof setting === 'string') {
        return { severity: setting, options: previous.options };
    }
    const [severity, options] = setting;
    return {
        severity,
        options: options ? mergeOptions(previous.options, options, { keepNegations: true }) : previous.options,
    };
}

/**
 * Lays options over others, lists accumulating. A rule's state is the options set so far, without
 * its defaults, which are laid under it last: so a `"!x"` that removes nothing yet is kept there
 * (`keepNegations`) and still takes `x` out of the rule's defaults — `names: ["!utils"]` used
 * to leave the default `utils` in.
 */
export function mergeOptions(
    base: Readonly<Record<string, unknown>>,
    layer: Readonly<Record<string, unknown>>,
    { keepNegations = false }: { readonly keepNegations?: boolean } = {},
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(layer)) {
        const previous = merged[key];
        merged[key] =
            Array.isArray(value) && (Array.isArray(previous) || previous === undefined)
                ? mergeList((previous as unknown[] | undefined) ?? [], value, { keepNegations })
                : value;
    }
    return merged;
}

/**
 * Appends without repeating; `"!x"` removes `x`. With `keepNegations`, a `"!x"` that finds no
 * `x` stays in the list, to remove it from what is laid under later; a later `"x"` replaces it.
 */
export function mergeList<T>(
    base: readonly T[],
    layer: readonly T[] | undefined,
    { keepNegations = false }: { readonly keepNegations?: boolean } = {},
): T[] {
    const result = [...base];
    for (const item of layer ?? []) {
        if (typeof item === 'string' && item.startsWith('!')) {
            const index = (result as readonly unknown[]).indexOf(item.slice(1));
            if (index !== -1) {
                result.splice(index, 1);
            } else if (keepNegations && !result.includes(item)) {
                result.push(item);
            }
            continue;
        }
        const negation = typeof item === 'string' ? (result as readonly unknown[]).indexOf(`!${item}`) : -1;
        if (negation !== -1) {
            result.splice(negation, 1);
        }
        if (!result.includes(item)) {
            result.push(item);
        }
    }
    return result;
}
