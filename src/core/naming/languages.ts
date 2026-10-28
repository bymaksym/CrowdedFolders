/**
 * The language codes a translated file name ends in: `README-ja`, `strings_pt_BR`, `messages.zh-Hant`,
 * `app_fil.arb`.
 *
 * - The two-letter codes of ISO 639-1.
 * - The three-letter codes (ISO 639-2 and 639-3) of the languages CLDR has locales for, which
 *   Flutter's gen-l10n, Android and iOS accept: `fil`, `ckb`, `yue`, `gsw`, `haw`.
 *
 * A language tag uses the two-letter code when there is one (BCP 47), so the three-letter codes in
 * real file names are those of languages without one. Not every ISO 639-3 code: there are almost
 * eight thousand, and among them are `app`, `map` and `art`, which would make `user-map` a
 * translation.
 */
const LANGUAGES: ReadonlySet<string> = new Set(
    [
        // ISO 639-1
        'aa ab ae af ak am an ar as av ay az ba be bg bh bi bm bn bo br bs ca ce ch co cr cs cu cv cy',
        'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu',
        'hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb',
        'lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om',
        'or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw',
        'ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu',
        // CLDR locales with a three-letter code
        'agq asa ast bas bem bez brx ccp ceb cgg chr ckb dav dje doi dsb dua dyo ebu ewo fil fur gsw guz',
        'haw hsb jgo jmc kab kam kde kea kgp khq kkj kln kok ksb ksf ksh lag lkt lrc luo luy mai mas mer',
        'mfe mgh mgo mni mua mzn naq nds nmg nnh nus nyn osa pcm rof rwk sah saq sat sbp seh ses shi smn',
        'teo tok twq tzm vai vun wae xog yav yrl yue zgh',
    ]
        .join(' ')
        .split(' '),
);

/**
 * Whether words are a language tag: a language code, then optionally a script and a region
 * (`pt-BR`, `zh-Hant`, `zh-Hant-TW`). A region is two letters (ISO 3166) or three digits (UN M.49:
 * `es-419` is Latin American Spanish). Words come lowercase, from `splitWords`.
 */
export function isLanguageTag(words: readonly string[]): boolean {
    const [language, ...details] = words;
    return (
        language !== undefined &&
        LANGUAGES.has(language) &&
        details.length <= 2 &&
        details.every(detail => detail.length === 2 || detail.length === 4 || isRegionNumber(detail))
    );
}

function isRegionNumber(word: string): boolean {
    return word.length === 3 && /^\d{3}$/u.test(word);
}
