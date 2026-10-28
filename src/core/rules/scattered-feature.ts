import { sameWord } from '../naming/inflect.ts';
import { compareText, keyRestatesPath, type Module } from '../naming/modules.ts';
import { isNumericWord, splitWords } from '../naming/words.ts';
import { mirrorOf } from '../paths/mirrors.ts';
import { baseName, joinPath, parentOf } from '../paths/tree.ts';
import { caseless, folderNameFor, planMoves } from './moves.ts';
import {
    defineRule,
    type FolderView,
    hintText,
    listNames,
    type Move,
    type RuleContext,
    type TreeProblem,
} from './rule.ts';

export interface ScatteredFeatureOptions {
    readonly layers: readonly string[];
    readonly min: number;
    readonly ignore: readonly string[];
    readonly hint: string;
}

/** A layer folder as the rule keeps it until the end of the run. */
interface Layer {
    readonly view: FolderView;
    readonly options: ScatteredFeatureOptions;
}

/** One feature word of a layered folder: the modules about it, by the layer folder they are in. */
interface Feature {
    /** The shortest spelling seen, which is the singular when there is one: `status` over `statuses`. */
    word: string;
    readonly layers: Map<Layer, Module[]>;
}

export const scatteredFeature = defineRule<ScatteredFeatureOptions>({
    meta: {
        description:
            'A feature is one folder, not a word repeated in every layer folder: `RegistroController`, `RegistroService`, `RegistroRepository`, `RegistroDto` and `Registro` in `controller/`, `service/`, `repository/`, `dto/` and `model/` are a `registro/` package nobody made. Reported once, at the folder that holds the layers, with every move.',
        url: 'https://github.com/bymaksym/CrowdedFolders/blob/main/docs/rules/scattered-feature.md',
        defaultOptions: {
            layers: ['controller', 'service', 'repository', 'repo', 'dao', 'dto', 'model', 'entity', 'mapper'],
            min: 3,
            ignore: [],
            hint: '',
        },
        options: {
            type: 'object',
            additionalProperties: false,
            properties: {
                layers: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    uniqueItems: true,
                    description:
                        'Names of the folders that hold a layer, in any case, singular or plural: `service` matches `service/`, `services/` and `Services/`.',
                },
                min: {
                    type: 'integer',
                    minimum: 2,
                    description: 'In how many layer folders of one folder a word has to start a name to be reported.',
                },
                ignore: {
                    type: 'array',
                    items: { type: 'string', minLength: 1 },
                    uniqueItems: true,
                    description:
                        'Words that start names in every layer and are no feature, lowercase: `base`, `api`, `app`.',
                },
                hint: {
                    type: 'string',
                    description: 'Added to the message: what a feature folder is in this ecosystem.',
                },
            },
        },
    },
    create({ report }) {
        const layers = new Map<string, Layer[]>();
        const subfolders = new Map<string, readonly string[]>();
        let existing: RuleContext<object>['existing'];
        return {
            folder(view, context) {
                existing ??= context.existing;
                subfolders.set(view.path, view.folders);
                if (view.path === '.' || !isLayer(view.name, context.options.layers)) {
                    return;
                }
                const parent = parentOf(view.path);
                const list = layers.get(parent) ?? [];
                list.push({ view, options: context.options });
                layers.set(parent, list);
            },
            done() {
                for (const [parent, own] of layers) {
                    const options = own[0]?.options;
                    if (options === undefined) {
                        continue;
                    }
                    const mirrored = (own[0]?.view.naming.mirrors ?? [])
                        .map(mirror => mirrorOf(parent, mirror))
                        .filter((path): path is string => path !== undefined && path !== parent)
                        .flatMap(path => (layers.get(path) ?? []).map(layer => ({ path, layer })));
                    const features = featuresOf(own, parent, options);
                    for (const feature of features) {
                        if (feature.layers.size < options.min) {
                            continue;
                        }
                        const twins = new Map<string, Layer[]>();
                        for (const { path, layer } of mirrored) {
                            if (layer.view.modules.some(module => isAbout(module, feature.word))) {
                                twins.set(path, [...(twins.get(path) ?? []), layer]);
                            }
                        }
                        report({ folder: parent, ...problemOf(parent, feature, twins, options, subfolders, existing) });
                    }
                }
            },
        };
    },
});

function isLayer(name: string, layers: readonly string[]): boolean {
    const words = splitWords(name);
    return words.length === 1 && layers.some(layer => sameWord(layer.toLowerCase(), words[0] ?? ''));
}

/** Whether a module is about `word`: its subject starts with it, singular or plural. */
function isAbout(module: Module, word: string): boolean {
    return sameWord(module.subject[0] ?? '', word);
}

/** The words that start module names in the layer folders of `parent`, each with its modules by layer. */
function featuresOf(own: readonly Layer[], parent: string, options: ScatteredFeatureOptions): Feature[] {
    const features: Feature[] = [];
    for (const layer of own) {
        for (const module of layer.view.modules) {
            const word = module.subject[0];
            if (
                word === undefined ||
                isNumericWord(word) ||
                options.ignore.includes(word) ||
                options.layers.some(name => sameWord(name.toLowerCase(), word)) ||
                // Already a feature folder: users/infrastructure/persistence/{entities,mappers,repositories}/user.*
                keyRestatesPath(word, parent, [module])
            ) {
                continue;
            }
            let feature = features.find(candidate => sameWord(candidate.word, word));
            if (!feature) {
                feature = { word, layers: new Map() };
                features.push(feature);
            } else if (word.length < feature.word.length) {
                feature.word = word;
            }
            feature.layers.set(layer, [...(feature.layers.get(layer) ?? []), module]);
        }
    }
    return features;
}

/** The problem of one feature: what it is spread over, and the moves that make it one folder. */
function problemOf(
    parent: string,
    feature: Feature,
    twins: ReadonlyMap<string, readonly Layer[]>,
    options: ScatteredFeatureOptions,
    subfolders: ReadonlyMap<string, readonly string[]>,
    existing: RuleContext<object>['existing'],
): Omit<TreeProblem, 'folder'> {
    const naming = [...feature.layers.keys()][0]?.view.naming;
    const name = naming ? folderNameFor([feature.word], naming).name : feature.word;
    const modules = [...feature.layers.values()].flat();
    const files = [...feature.layers].flatMap(([layer, list]) =>
        list.flatMap(module => module.files.map(file => `${layer.view.name}/${file}`)),
    );
    const layerNames = [...feature.layers.keys()].map(layer => `${layer.view.name}/`).toSorted(compareText);
    const where = `${feature.layers.size} layer folders (${listNames(layerNames, 6)})`;
    const head = `"${feature.word}" starts ${modules.length} module names across ${where}: a feature split by layer.`;
    if (name === undefined) {
        return {
            message: `${head} Every name a folder for it could take is a reserved word: package them by feature under a name you choose.`,
            key: feature.word,
            measured: feature.layers.size,
            limit: options.min - 1,
            files,
        };
    }
    const moves: Move[] = [];
    const notes: string[] = [];
    const plan = (root: string, groups: Iterable<readonly [Layer, readonly Module[]]>): string => {
        const target = joinPath(root, intoExisting(name, subfolders.get(root) ?? []));
        // Shared by the layers: model/Order.java and entity/Order.java cannot both become order/Order.java.
        const taken = new Set<string>();
        for (const [layer, list] of groups) {
            const planned = planMoves(list, layer.view.path, target, keepName, existing, taken);
            moves.push(...planned.moves);
            notes.push(...planned.notes);
        }
        return target;
    };
    const target = plan(parent, feature.layers);
    for (const [root, list] of twins) {
        plan(
            root,
            list.map(layer => [layer, layer.view.modules.filter(module => isAbout(module, feature.word))] as const),
        );
    }
    const mirrorsNote = twins.size === 0 ? '' : ` Their tests in ${[...twins.keys()].join(', ')} go the same way.`;
    return {
        message: `${head} Package by feature: move them into ${target}/, one folder for everything about ${feature.word}.${mirrorsNote}${notes.map(note => ` ${note}`).join('')}${hintText(options.hint, [], files)}`,
        key: feature.word,
        measured: feature.layers.size,
        limit: options.min - 1,
        files,
        moves,
    };
}

/** The sub-folder that already is the feature's folder, written in other case; else the name itself. */
function intoExisting(name: string, folders: readonly string[]): string {
    return folders.find(folder => caseless(folder) === caseless(name)) ?? baseName(name);
}

/** A move that keeps every file's name: a class is named like its file, and renaming one renames the other. */
function keepName(): string | undefined {
    return;
}
