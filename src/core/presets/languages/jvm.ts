import type { Preset } from '../../config/types.ts';

/**
 * Test sources in Maven and Gradle: src/test, and the source sets Gradle names after what they test
 * (src/integrationTest, src/androidTest, src/commonTest).
 */
const TEST_SOURCES = ['**/src/test', '**/src/test/**', '**/src/*Test', '**/src/*Test/**'];

/**
 * Words a package cannot be called: Java's keywords and literals, and Kotlin's hard keywords (a
 * Kotlin package called `object` needs backticks in every import).
 */
const JVM_KEYWORDS = [
    'abstract assert boolean break byte case catch char class const continue',
    'default do double else enum extends final finally float for goto if',
    'implements import instanceof int interface long native new package private',
    'protected public return short static strictfp super switch synchronized this',
    'throw throws transient try void volatile while true false null',
    'as fun in is object typealias typeof val var when',
].flatMap(line => line.split(' '));

/** The files whose folder is a package: not the SQL, templates or changelogs of a Java project. */
const JVM_FILES = ['*.{java,kt,kts,groovy,scala}'];

export const java: Preset = {
    description:
        'Java and Kotlin with Maven or Gradle: a folder is a package, so groups of classes sharing a name (UserService, UserRepository, UserController) suggest packaging by feature. UserServiceImpl is UserService, and in test sources UserServiceTest and UserServiceIT are too; AbstractUserService, DefaultUserService and FakeUserService are about user; package-info.java and module-info.java describe the package and do not count; and a build/ or target/ is left out only next to the pom.xml or build.gradle that owns it (com/acme/build is a package). A move proposes a package as Java writes them (registrohorario/, never a keyword such as abstract/), keeps the class names, takes src/test along with src/main, and leaves the application-{profile}.yml of Spring where Spring looks for them. The composeResources/ of Compose Multiplatform (drawable, font, values, files: a fixed layout) is left out, also in a Kotlin Multiplatform project without an AndroidManifest.xml. One top-level class per file makes folders larger than in TypeScript, hence 20: across five Java repositories (docs/field-trial.md) the 95th percentile of modules per folder is 9 to 32, median 11.',
    sources: [
        {
            title: 'Maven: standard directory layout',
            url: 'https://maven.apache.org/guides/introduction/introduction-to-the-standard-directory-layout.html',
        },
        { title: 'Google Java style guide', url: 'https://google.github.io/styleguide/javaguide.html' },
        {
            title: 'Kotlin coding conventions: directory structure',
            url: 'https://kotlinlang.org/docs/coding-conventions.html',
        },
        {
            title: 'IntelliJ inspection: package with too many classes (50)',
            url: 'https://jetbrains.com/help/inspectopedia/PackageWithTooManyClasses.html',
        },
        {
            title: 'Martin Fowler, Test Double: the kinds Gerard Meszaros lists (dummy, fake, stub, spy, mock)',
            url: 'https://martinfowler.com/bliki/TestDouble.html',
        },
        {
            title: 'Java language specification: keywords "cannot be used as identifiers"; package names are lowercase',
            url: 'https://docs.oracle.com/javase/specs/jls/se21/html/jls-3.html#jls-3.9',
        },
        { title: 'Kotlin: hard keywords', url: 'https://kotlinlang.org/docs/keyword-reference.html#hard-keywords' },
        {
            title: 'Spring Boot: profile-specific files are application-{profile}.properties, looked for next to application.properties',
            url: 'https://docs.spring.io/spring-boot/reference/features/external-config.html#features.external-config.files.profile-specific',
        },
        {
            title: 'Gradle: buildSrc "is a separate build located in the root of your Gradle project"',
            url: 'https://docs.gradle.org/current/userguide/organizing_gradle_projects.html',
        },
        {
            title: 'Compose Multiplatform resources: images in the drawable directory, fonts in the font directory',
            url: 'https://kotlinlang.org/docs/multiplatform/compose-multiplatform-resources-setup.html',
        },
        {
            title: 'Spring Boot: auto-configuration is registered in META-INF/spring',
            url: 'https://docs.spring.io/spring-boot/reference/features/developing-auto-configuration.html',
        },
    ],
    detect: { files: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'] },
    keeps: {
        'redundant-prefix':
            'a package is a feature and its classes say what they are (user/UserService, user/UserRepository): the name of the class is what imports and stack traces show',
    },
    config: {
        extends: ['recommended'],
        // Anchored to the manifest that owns them (init and detection rebase these for each module):
        // com/acme/build and com/acme/generated are packages. META-INF is read by the JVM and Spring
        // by name and layout (META-INF/services, META-INF/spring), one file per folder.
        // composeResources (Compose Multiplatform) has a fixed layout, drawable, font, values, files,
        // and a Kotlin Multiplatform project without an AndroidManifest.xml is detected only as java.
        exclude: ['/target', '/build', '.gradle', 'META-INF', '**/src/*/composeResources'],
        naming: {
            companions: ['Impl$'],
            folderFiles: ['package-info.java', 'module-info.java'],
            // What a class is called before what it is about: test doubles (Fowler's dummy, fake, stub,
            // spy and mock) and the base classes of the JDK and Spring (AbstractList, DefaultListableBeanFactory).
            ignoreLeadingWords: ['fake', 'mock', 'stub', 'spy', 'dummy', 'abstract', 'base', 'default', 'simple'],
            folderCase: 'lower',
            reservedWords: JVM_KEYWORDS,
            // Spring loads the profiles by these names, next to each other.
            keepInPlace: ['application.{yml,yaml,properties}', 'application-*.{yml,yaml,properties}'],
            mirrors: ['**/src/main/java/** => **/src/test/java/**', '**/src/main/kotlin/** => **/src/test/kotlin/**'],
        },
        overrides: [
            {
                folders: TEST_SOURCES,
                reason: 'A test class is named after the class it tests (UserServiceTest, UserServiceIT), and only in test sources: elsewhere SpeedTest and AuditIT are names of their own.',
                naming: { companions: ['(Test|Tests|IT|IntegrationTest|Spec)$'] },
            },
            {
                folders: ['**/build-logic', '**/build-logic/**', '**/buildSrc', '**/buildSrc/**'],
                reason: 'Convention plugins are named after the platform they configure (AndroidApplicationConventionPlugin, AndroidLibraryConventionPlugin): the platform is not what they are about.',
                naming: { ignoreLeadingWords: ['android', 'ios', 'jvm'] },
            },
        ],
        rules: {
            'max-files': [
                'error',
                {
                    max: 20,
                    count: 'modules',
                    hint: 'A folder is a package: package by feature (user/, order/), not by layer.',
                    hintFor: JVM_FILES,
                },
            ],
            'prefix-groups': [
                'error',
                {
                    hint: 'A folder is a package: they would be the package of that feature.',
                    hintFor: JVM_FILES,
                    // A public class is named like its file: UserService stays UserService in user/.
                    dropPrefix: false,
                },
            ],
            // Kept off under strict: user/UserService is the idiom, not a repetition.
            'redundant-prefix': 'off',
        },
    },
};

export const android: Preset = {
    description:
        'Java/Kotlin, plus Android resources: res/ folders cannot have subfolders ("Alternative resource directories can\'t be nested"), so prefixes such as activity_, fragment_ and ic_ are the only grouping there is. res/ and the composeResources/ of Kotlin Multiplatform (the same fixed layout: drawable, font, values, files) are left out, and Platform.kt, Platform.android.kt and Platform.ios.kt are one module, as the Kotlin conventions name them.',
    sources: [
        {
            title: 'Android: providing resources',
            url: 'https://developer.android.com/guide/topics/resources/providing-resources',
        },
        {
            title: 'Compose Multiplatform resources: images in the drawable directory, fonts in the font directory',
            url: 'https://kotlinlang.org/docs/multiplatform/compose-multiplatform-resources-setup.html',
        },
        {
            title: 'Kotlin coding conventions, multiplatform: files in platform source sets take a suffix (Platform.jvm.kt, Platform.android.kt)',
            url: 'https://kotlinlang.org/docs/coding-conventions.html',
        },
        {
            title: 'ribot Android guidelines: resource naming',
            url: 'https://github.com/ribot/android-guidelines/blob/master/project_and_code_guidelines.md',
        },
    ],
    detect: { files: ['AndroidManifest.xml'] },
    config: {
        extends: ['java'],
        // composeResources (Compose Multiplatform) has the same fixed layout as res: drawable, font,
        // values and files, with the qualifier in the folder name (drawable-hdpi).
        exclude: ['**/src/*/res', '/res', '**/src/*/composeResources'],
    },
};
