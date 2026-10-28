import { describe, it } from 'node:test';

import { RuleTester } from '../../../testing.ts';
import { orphanCompanions } from './orphan-companions.ts';
import { typeFolders } from './type-folders.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester();

/** UnityTechnologies/open-project-1, as the field trial lists it. */
const GLADE = 'UOP1_Project/Assets/Scenes/Whiteboxing/Community/GeneralMapMediumMultipleScenes';

tester.run('orphan-companions', orphanCompanions, {
    valid: [
        {
            name: 'open-project-1: each scene with its .meta, and Beach.meta with its folder Beach/',
            files: [
                `${GLADE}/Beach.meta`,
                `${GLADE}/Beach.unity`,
                `${GLADE}/Beach.unity.meta`,
                `${GLADE}/Beach/LightingData.asset`,
                `${GLADE}/Beach/LightingData.asset.meta`,
            ],
        },
        {
            name: "open-project-1: Glade.meta is an empty folder's, which git cannot store and Unity makes again",
            files: [`${GLADE}/Glade.meta`, `${GLADE}/Beach.unity`, `${GLADE}/Beach.unity.meta`],
        },
        {
            name: 'godot-demo-projects: a texture with its .import',
            files: [
                '3d/antialiasing/polyhaven/textures/dutch_ship_medium_hull_arm_1k.jpg',
                '3d/antialiasing/polyhaven/textures/dutch_ship_medium_hull_arm_1k.jpg.import',
                '3d/antialiasing/player.gd',
                '3d/antialiasing/player.gd.uid',
            ],
        },
        {
            name: "the asset is there but left out of the check: Unity's Plugins.meta with Assets/Plugins excluded",
            files: ['Assets/Plugins.meta', 'Assets/Plugins/Vendor.dll', 'Assets/Plugins/Vendor.dll.meta'],
            config: { exclude: ['Assets/Plugins'] },
        },
        {
            name: 'a suffix not asked for',
            files: ['Assets/Player.cs.meta'],
            options: { suffixes: ['!.meta'] },
        },
    ],
    invalid: [
        {
            name: 'Player.cs.meta whose Player.cs was moved outside Unity',
            files: ['Assets/Scripts/Player.cs.meta', 'Assets/Scripts/Enemy.cs', 'Assets/Scripts/Enemy.cs.meta'],
            errors: [
                {
                    folder: 'Assets/Scripts',
                    measured: 1,
                    limit: 0,
                    files: ['Assets/Scripts/Player.cs.meta'],
                    message:
                        /^Player\.cs\.meta is without its asset: the asset was moved, renamed or deleted outside the editor/u,
                },
            ],
        },
        {
            name: 'Godot: icon.png.import and player.gd.uid left behind',
            files: ['art/icon.png.import', 'art/player.gd.uid', 'art/enemy.png', 'art/enemy.png.import'],
            errors: [{ folder: 'art', measured: 2, files: ['art/icon.png.import', 'art/player.gd.uid'] }],
        },
        {
            name: 'a .meta whose asset differs in case, which Linux and git tell apart',
            files: ['Assets/player.cs', 'Assets/Player.cs.meta'],
            errors: [{ folder: 'Assets', message: /Player\.cs\.meta \(next to player\.cs\) differs only in case/u }],
        },
        {
            name: "open-project-1: with emptyFolders, Glade.meta's missing folder is reported",
            files: [`${GLADE}/Glade.meta`, `${GLADE}/Beach.unity`],
            options: { emptyFolders: true },
            errors: [{ folder: GLADE, files: [`${GLADE}/Glade.meta`] }],
        },
    ],
});

tester.run('type-folders', typeFolders, {
    valid: [
        {
            name: "Allar 2.7 and 2.8: Animations, Audio and MaterialLibrary are the guide's own folders",
            files: [
                'Content/Characters/Common/Animations/A_Run.uasset',
                'Content/ExampleContent/Audio/S_Hit.uasset',
                'Content/Project/MaterialLibrary/M_Master.uasset',
            ],
        },
        {
            name: 'a folder named after what it is for',
            files: ['Content/Environment/Rocks/SM_Rock.uasset', 'Content/Environment/Rocks/T_Rock_D.uasset'],
        },
    ],
    invalid: [
        {
            name: 'tomlooman/ActionRoguelike: Materials and Textures folders',
            files: [
                'Content/ActionRoguelike/Materials/MF_HitFlashDemo.uasset',
                'Content/ActionRoguelike/Materials/MI_RageBar.uasset',
                'Content/Characters/Mannequins/Textures/T_Manny_01_D.uasset',
                'Content/Characters/Mannequins/Meshes/SKM_Manny.uasset',
            ],
            errors: [
                {
                    folder: 'Content/ActionRoguelike/Materials',
                    message: /^"Materials" is named after the type of its assets/u,
                    measured: 1,
                },
                { folder: 'Content/Characters/Mannequins/Meshes' },
                { folder: 'Content/Characters/Mannequins/Textures' },
            ],
        },
        {
            name: 'godot-demo-projects: textures/, singular or plural, with the hint',
            files: ['3d/antialiasing/polyhaven/textures/hull_1k.jpg', '2d/physics_tests/assets/texture/icon.png'],
            options: { names: ['!assets'], hint: 'Godot: "group assets as close to scenes as possible".' },
            errors: [
                { folder: '2d/physics_tests/assets/texture', message: /Godot: "group assets/u },
                { folder: '3d/antialiasing/polyhaven/textures' },
            ],
        },
    ],
});
