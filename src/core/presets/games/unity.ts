import type { Preset } from '../../config/types.ts';
import { MEDIA } from '../general.ts';

/** A number at the end of an asset's name: the copies Unity makes, and numbered variants. */
const NUMBERED = String.raw`_?\d+$`;

export const unity: Preset = {
    description:
        'Unity: every asset has a .meta next to it (Player.cs and Player.cs.meta are one), Scripts.meta goes with the folder Scripts/, numbered series such as Model1, Model_2 are one asset family (in Scripts/ only with a separator: Base64.cs is not Base), and Library, Temp, Packages and third-party plugins are left out. C# reads as in the dotnet preset.',
    sources: [
        {
            title: 'Unity manual: asset metadata (.meta files)',
            url: 'https://docs.unity3d.com/Manual/AssetMetadata.html',
        },
        { title: 'Unity manual: special folder names', url: 'https://docs.unity3d.com/Manual/SpecialFolders.html' },
        {
            title: 'Unity: best practices for organizing your project',
            url: 'https://unity.com/how-to/organizing-your-project',
        },
    ],
    detect: { files: ['ProjectSettings/ProjectVersion.txt'] },
    config: {
        extends: ['dotnet'],
        // The assets are the project here: textures, sounds and models count.
        exclude: [`!${MEDIA}`, '/Library', '/Temp', '/Logs', '/UserSettings', '/Packages', 'Assets/Plugins', '*~'],
        // Almond2.prefab and Rock_03.fbx are copies of one asset.
        naming: { companions: [NUMBERED], folderCompanions: ['.meta'] },
        overrides: [
            {
                folders: ['**/Scripts', '**/Scripts/**'],
                reason: 'A script is named after its type, and a number there is part of the name: Base64, Sha256 and Md5 are not copies of Base, Sha and Md. Only a separated number (Spawner_2) is a copy.',
                naming: { companions: [`!${NUMBERED}`, String.raw`[ _-]\d+$`] },
            },
        ],
        rules: {
            'prefix-groups': [
                'warn',
                {
                    min: 15,
                    hint: `Allar's rule 2.7, the one number game guides give: "If you find yourself having 15+ of these assets that belong together, they should be together."`,
                },
            ],
            'max-files': ['error', { max: 30, count: 'modules' }],
        },
    },
};
