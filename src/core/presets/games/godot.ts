import type { Preset } from '../../config/types.ts';
import { MEDIA } from '../general.ts';

export const godot: Preset = {
    description:
        "Godot: a scene and its script are one (player.tscn, player.gd), and so are the .import and .uid files next to an asset. Godot's guide asks to keep resources close to the scenes that use them — folders by feature — so numbered frames (run_01.png … run_24.png) are one animation, not 24 modules. .godot and addons/ (third-party resources, in the guide's words) are left out; `crowded-folders init` lists the addons it finds and writes one exclusion for each, so that your own plugins can be checked by deleting their line. An .import or .uid file without its asset is an error (orphan-companions), and a folder named textures/, materials/ or meshes/ a warning (type-folders): the guide groups assets by what uses them and names no type folder, so this is read from it, not quoted.",
    sources: [
        {
            title: 'Godot: project organization',
            url: 'https://docs.godotengine.org/en/stable/tutorials/best_practices/project_organization.html',
        },
        {
            title: "Allar's UE5 style guide, rule 2.7: the number 15 is borrowed from it, Godot's guide gives none",
            url: 'https://github.com/Allar/ue5-style-guide',
        },
        { title: 'Godot 4.4: .uid files', url: 'https://godotengine.org/article/uid-changes-coming-to-godot-4-4/' },
        {
            title: 'Godot: import process, "Make sure to commit these files to your version control system, as these files contain important metadata"',
            url: 'https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/import_process.html',
        },
    ],
    detect: { files: ['project.godot'] },
    config: {
        extends: ['recommended'],
        // The assets are the project here: textures, sounds and models count.
        exclude: [`!${MEDIA}`, '.godot', '/addons'],
        // run_01.png … run_24.png: the frames of one animation, with their .import files.
        naming: { companions: [String.raw`_\d+$`] },
        rules: {
            // "Importing will add an extra <asset>.import file next to the source file … Make sure to
            // commit these files" (Godot: import process); a .uid file holds the ID a reference uses.
            'orphan-companions': 'error',
            'type-folders': [
                'warn',
                {
                    // res://assets/ is the usual root of a Godot project; the guide's own example has models/.
                    names: ['!assets'],
                    hint: "Godot's guide: 'group assets as close to scenes as possible'.",
                },
            ],
            'prefix-groups': [
                'warn',
                {
                    min: 15,
                    hint: 'Godot\'s guide groups assets "as close to scenes as possible" and gives no number: the 15 is borrowed from Allar\'s Unreal guide (rule 2.7) and is an opinion here.',
                },
            ],
        },
    },
};
