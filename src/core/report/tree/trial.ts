import { plural } from '../../plural.ts';
import { FIELD_TRIAL, type FieldTrial } from './trial-data.ts';

/** How a folder compares with the folders of the field trial. */
export interface TrialComparison {
    /** Whole percent of the folders measured that hold fewer modules than this one (rounded down). */
    readonly biggerThan: number;
    /** The folders and repositories behind the figure: a percentile without its n is a number from nowhere. */
    readonly folders: number;
    readonly repos: number;
}

/**
 * Where a folder of `modules` modules stands among the folders of the field trial; `undefined` when the
 * trial has no data (a build before it was run) or the folder has no modules.
 */
export function compareWithTrial(modules: number, trial: FieldTrial = FIELD_TRIAL): TrialComparison | undefined {
    if (trial.folders <= 0 || modules < 1) {
        return undefined;
    }
    let smaller = 0;
    for (let size = 0; size < modules && size < trial.modules.length; size++) {
        smaller += trial.modules[size] ?? 0;
    }
    return {
        biggerThan: Math.floor((smaller / trial.folders) * 100),
        folders: trial.folders,
        repos: trial.repos,
    };
}

/** "29 modules: bigger than 97 % of the folders of 36 open-source repositories (n=9,876)." */
export function describeComparison(modules: number, trial: FieldTrial = FIELD_TRIAL): string | undefined {
    const comparison = compareWithTrial(modules, trial);
    return comparison === undefined
        ? undefined
        : `${plural(modules, 'module')}: bigger than ${comparison.biggerThan} % of the folders of ${comparison.repos} open-source repositories (n=${comparison.folders.toLocaleString('en-US')}).`;
}
