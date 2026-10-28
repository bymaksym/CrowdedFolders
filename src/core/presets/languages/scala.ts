import type { Preset } from '../../config/types.ts';

export const scala: Preset = {
    description:
        "Scala with sbt: the file is named after the class it contains, FooSpec, FooSuite and FooTest are Foo, and the directories of sbt (target, project/target, project/project) are left out. Packages need not follow the folders, but they usually do. The limits are recommended's measured 20: neither the Scala style guide nor sbt gives a number.",
    sources: [
        {
            title: 'Scala style guide, files: "the file is named after the class it contains, or if it has more than one class, the parent class"',
            url: 'https://docs.scala-lang.org/style/files.html',
        },
        {
            title: 'sbt: directory structure (src/main/scala, target, project/)',
            url: 'https://www.scala-sbt.org/1.x/docs/Directories.html',
        },
    ],
    detect: { files: ['build.sbt'] },
    config: {
        extends: ['recommended'],
        // Anchored to the build.sbt that owns them (init and detection rebase these for each module).
        exclude: ['/target', '/project/target', '/project/project', '.bsp', '.metals'],
        naming: { companions: ['(?:Spec|Suite|Test|Tests)$'] },
    },
};
