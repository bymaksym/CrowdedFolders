import type { Preset } from '../../config/types.ts';
import { MEDIA } from '../general.ts';

/** A number at the end of an asset's name: the copies Unity makes, and numbered variants. */
const NUMBERED = String.raw`_?\d+$`;

const SCRIPTS =
    'A script is named after its type, and a number there is part of the name: Base64, Sha256 and Md5 are not copies of Base, Sha and Md. Only a separated number (Spawner_2) is a copy.';

export const unity: Preset = {
    description:
        'Unity: every asset has a .meta next to it (Player.cs and Player.cs.meta are one), Scripts.meta goes with the folder Scripts/, numbered series such as Model1, Model_2 are one asset family (in Scripts/ and in any folder holding .cs scripts only with a separator: Base64.cs is not Base), and Library, Temp, ProjectSettings (one .asset per setting, written by Unity) and third-party code (Plugins, TextMesh Pro, Samples, ThirdParty) are left out. The manifest files of Packages/ are left out, the embedded packages in it are your code and are checked. C# reads as in the dotnet preset. The Unity guide splits by asset type and gives no number: the 15 for groups is borrowed from the Allar guide for Unreal and is an opinion here. A .meta without its asset is an error (orphan-companions): the Unity manual says a .meta "must stay with the asset file", and the .meta of an empty folder, which git cannot store, is not reported.',
    sources: [
        {
            title: 'Unity manual: asset metadata (.meta files)',
            url: 'https://docs.unity3d.com/Manual/AssetMetadata.html',
        },
        { title: 'Unity manual: special folder names', url: 'https://docs.unity3d.com/Manual/SpecialFolders.html' },
        {
            title: 'Unity manual: embedding a package in a project (Packages/<name>)',
            url: 'https://docs.unity3d.com/Manual/upm-embed.html',
        },
        {
            title: "Allar's UE5 style guide, rule 2.7: the number 15 is borrowed from it, Unity's guide gives none",
            url: 'https://github.com/Allar/ue5-style-guide',
        },
        {
            title: 'Unity: best practices for organizing your project',
            url: 'https://unity.com/how-to/organizing-your-project',
        },
    ],
    detect: { files: ['ProjectSettings/ProjectVersion.txt'] },
    config: {
        extends: ['dotnet'],
        // The assets are the project here: textures, sounds and models count.
        exclude: [
            `!${MEDIA}`,
            '/Library',
            '/Temp',
            '/Logs',
            '/UserSettings',
            '/ProjectSettings',
            '/Packages/*.json',
            'Assets/Plugins',
            'Assets/TextMesh Pro',
            'Assets/Samples',
            'Assets/ThirdParty',
            '*~',
        ],
        // Almond2.prefab and Rock_03.fbx are copies of one asset.
        naming: { companions: [NUMBERED], folderCompanions: ['.meta'] },
        overrides: [
            {
                folders: ['**/Scripts', '**/Scripts/**'],
                reason: SCRIPTS,
                naming: { companions: [`!${NUMBERED}`, String.raw`[ _-]\d+$`] },
            },
            {
                // Scripts live wherever the project puts them: Assets/Code, Packages/<name>/Runtime.
                folders: ['**'],
                withFiles: ['*.cs'],
                reason: SCRIPTS,
                naming: { companions: [`!${NUMBERED}`, String.raw`[ _-]\d+$`] },
            },
        ],
        rules: {
            'prefix-groups': [
                'warn',
                {
                    min: 15,
                    hint: "Unity's guide splits a project by asset type and gives no number: the 15 is borrowed from Allar's Unreal guide (rule 2.7) and is an opinion here.",
                    // dotnet's hint is about C# files; this one is about any asset.
                    hintFor: ['!*.{cs,fs,vb}'],
                },
            ],
            'max-files': ['error', { max: 30, count: 'modules' }],
            // "Meta files … must stay with the asset file they relate to"; "if an asset loses its .meta
            // file, any reference to that asset is broken" (Unity manual, asset metadata).
            'orphan-companions': 'error',
        },
    },
};
