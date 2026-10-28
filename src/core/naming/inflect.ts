/**
 * A minimal English inflector, for words that are already lowercase: enough to tell that `users`,
 * `categories`, `classes`, `statuses` and `children` are `user`, `category`, `class`, `status` and
 * `child`, and that `news` is not `new`. It only has to compare two words that both appear in a
 * repository, so it does not need to know every word, only not to join two that differ.
 */

/** Plurals that no rule gives. */
const IRREGULAR: Readonly<Record<string, string>> = {
    child: 'children',
    person: 'people',
    man: 'men',
    woman: 'women',
    mouse: 'mice',
    foot: 'feet',
    tooth: 'teeth',
    goose: 'geese',
    ox: 'oxen',
    index: 'indices',
    vertex: 'vertices',
    matrix: 'matrices',
    appendix: 'appendices',
    analysis: 'analyses',
    axis: 'axes',
    basis: 'bases',
    crisis: 'crises',
    diagnosis: 'diagnoses',
    hypothesis: 'hypotheses',
    thesis: 'theses',
    criterion: 'criteria',
    phenomenon: 'phenomena',
    datum: 'data',
    medium: 'media',
    leaf: 'leaves',
    life: 'lives',
    knife: 'knives',
    wife: 'wives',
    half: 'halves',
    self: 'selves',
    shelf: 'shelves',
    wolf: 'wolves',
    thief: 'thieves',
    quiz: 'quizzes',
    cactus: 'cacti',
    radius: 'radii',
    stimulus: 'stimuli',
    alumnus: 'alumni',
};

const SINGULAR_OF: ReadonlyMap<string, string> = new Map(
    Object.entries(IRREGULAR).map(([singular, plural]) => [plural, singular]),
);

/**
 * Words ending in s that are not the plural of the word without it: `news` is not more than one
 * `new`, `ios` is not `io`, `https` is not `http`, `its` is not `it`.
 */
const NOT_PLURALS: ReadonlySet<string> = new Set([
    'news',
    'series',
    'species',
    'means',
    'lens',
    'ios',
    'css',
    'https',
    'its',
    'yes',
    'has',
    'was',
    'gas',
    'bus',
    'plus',
    'this',
    'thus',
    'status',
    'alias',
    'canvas',
    'atlas',
    'sms',
    'dns',
    'aws',
    'gps',
    'tls',
    'cms',
]);

const VOWELS = 'aeiou';

/** The plurals a lowercase word may take. */
export function pluralsOf(word: string): string[] {
    // One letter is not a word to inflect: `is` is not more than one `i`.
    if (word.length < 2) {
        return [];
    }
    const plurals: string[] = [];
    const irregular = IRREGULAR[word];
    if (irregular !== undefined) {
        plurals.push(irregular);
    }
    plurals.push(`${word}s`);
    if (/(?:[sxzo]|[cs]h)$/u.test(word)) {
        plurals.push(`${word}es`);
    }
    const last = word.at(-1);
    const beforeLast = word.at(-2) ?? '';
    if (last === 'y' && !VOWELS.includes(beforeLast)) {
        plurals.push(`${word.slice(0, -1)}ies`);
    }
    return plurals.filter(plural => !NOT_PLURALS.has(plural));
}

/**
 * The words a lowercase word could be the plural of, the word itself first: `categories` gives
 * `categories`, `category`; `classes` gives `classes`, `classe`, `class`. Only candidates that
 * {@link pluralsOf} would give back.
 */
export function singularsOf(word: string): string[] {
    const candidates = new Set<string>([word]);
    const irregular = SINGULAR_OF.get(word);
    if (irregular !== undefined) {
        candidates.add(irregular);
    }
    if (word.endsWith('ies')) {
        candidates.add(`${word.slice(0, -3)}y`);
    }
    if (word.endsWith('es')) {
        candidates.add(word.slice(0, -2));
    }
    if (word.endsWith('s')) {
        candidates.add(word.slice(0, -1));
    }
    return [...candidates].filter(candidate => candidate === word || pluralsOf(candidate).includes(word));
}

/** Whether two lowercase words are the same word, one maybe the plural of the other. */
export function sameWord(a: string, b: string): boolean {
    return a === b || pluralsOf(a).includes(b) || pluralsOf(b).includes(a);
}
