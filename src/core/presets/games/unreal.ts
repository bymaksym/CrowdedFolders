import type { Preset } from '../../config/types.ts';
import { MEDIA } from '../general.ts';

/**
 * The asset-type prefixes of Allar's guide (table 1.2), lowercase: BP_Door is a door, not a BP. A
 * group by type is what the guide forbids ("Do Not Create Folders Called Assets or AssetTypes"); the
 * group is the base asset name.
 */
const TYPE_PREFIXES = [
    'a',
    'abp',
    'ac',
    'ai',
    'aic',
    'am',
    'ao',
    'att',
    'bb',
    'bp',
    'bpfl',
    'bpi',
    'bpml',
    'bs',
    'bt',
    'ca',
    'cue',
    'curve',
    'dm',
    'dt',
    'dv',
    'dw',
    'e',
    'eqs',
    'f',
    'ffe',
    'fms',
    'font',
    'ft',
    'lg',
    'll',
    'ls',
    'm',
    'matinee',
    'mf',
    'mi',
    'mp',
    'mpc',
    'msw',
    'mt',
    'ne',
    'ns',
    'ol',
    'pfb',
    'phys',
    'pm',
    'pp',
    'ps',
    'rig',
    'rt',
    'rtc',
    's',
    'sgi',
    'sif',
    'sk',
    'skel',
    'sm',
    'sp',
    'spr',
    'sprg',
    'ss',
    't',
    'tbp',
    'tc',
    'ti',
    'tm',
    'ts',
    'vf',
    'vfa',
    'wbp',
];

/**
 * The class prefixes of Unreal C++ (UObject, IInterface) that some files keep in their name. Only
 * these two: `ai`, `font`, `curve` and `rig` are asset prefixes, and in Source/ AIController,
 * AITaskAttack and AIPerception are about AI.
 */
const CLASS_PREFIXES = ['u', 'i'];

export const unreal: Preset = {
    description:
        'Unreal Engine, after Allar\'s style guide: an asset is named Prefix_BaseAssetName_Variant_Suffix, the prefix is its type and the base asset name is its group. Prefixes and texture suffixes (_D, _N, _ORM…) are skipped, so SM_Rock, T_Rock_D and M_Rock are all about Rock — and 15 or more of them get their own folder (guide rule 2.7). The guide sets no maximum per folder; 50 here is an opinion, and both limits are warnings because the guide says "should", not "must". Source/ is C++, not assets, and is read with the limits of c-cpp.',
    sources: [
        { title: 'Google C++ style guide: file names', url: 'https://google.github.io/styleguide/cppguide.html' },
        {
            title: 'Unreal Engine: World Partition, actors are saved to their own individual files (One File Per Actor)',
            url: 'https://dev.epicgames.com/documentation/en-us/unreal-engine/world-partition-in-unreal-engine',
        },
        {
            title: "Allar's UE5 style guide (1.2 asset names, 2.6, 2.7)",
            url: 'https://github.com/Allar/ue5-style-guide',
        },
    ],
    detect: { files: ['*.uproject'] },
    config: {
        extends: ['recommended'],
        // The assets are the project here: textures, sounds and models count.
        exclude: [
            `!${MEDIA}`,
            '/Saved',
            '/Intermediate',
            '/DerivedDataCache',
            '/Binaries',
            'Content/Developers',
            // World Partition: one file per actor, named by hash, written by the editor.
            '__ExternalActors__',
            '__ExternalObjects__',
            '.vs',
        ],
        naming: { ignoreLeadingWords: CLASS_PREFIXES },
        rules: {
            'max-files': ['warn', { max: 50, count: 'modules' }],
            // A warning like max-files: both are the guide's "should" (rule 2.7), and a drawer of 200
            // assets must not pass while fifteen of one name break the build.
            'prefix-groups': [
                'warn',
                {
                    min: 15,
                    hint: 'Allar 2.7: "If you find yourself having 15+ of these assets that belong together, they should be together."',
                    hintFor: ['*.{uasset,umap}'],
                },
            ],
        },
        overrides: [
            {
                folders: ['**/Content', '**/Content/**'],
                reason: "Allar's guide names assets, which live in Content/: the type prefix (SM_, T_, BP_) and the texture suffix (_D, _N) are not what an asset is about. In Source/ the same words are C++ (AIController).",
                naming: {
                    ignoreLeadingWords: TYPE_PREFIXES,
                    companions: [
                        '_(D|N|R|A|O|B|E|M|S|H|L|ORM|MRA|ARM|RMA)$',
                        '_(P|Audio|Lighting|Geo|Gameplay)$',
                        '_(Cue|Decal|Color|Table|Float|Vector|SC|Component|Context)$',
                        String.raw`_\d+$`,
                    ],
                },
            },
            {
                folders: ['**/Source', '**/Source/**'],
                reason: "The 15 of Allar's rule 2.7 is about assets that belong together; C++ is code, and takes the limits of the c-cpp preset (20 modules, groups of 5).",
                rules: {
                    'max-files': ['error', { max: 20, count: 'modules' }],
                    'prefix-groups': [
                        'warn',
                        {
                            min: 5,
                            hint: "In C a shared prefix is often the subsystem's namespace: move them only if the subsystem deserves a directory.",
                            hintFor: ['*.{c,h,cc,cpp,cxx,hh,hpp,hxx,inl}'],
                        },
                    ],
                },
            },
        ],
    },
};
