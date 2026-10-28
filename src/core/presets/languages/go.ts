import type { Preset } from '../../config/types.ts';

const GOOS =
    'aix|android|darwin|dragonfly|freebsd|hurd|illumos|ios|js|linux|nacl|netbsd|openbsd|plan9|solaris|wasip1|windows|zos|unix';
const GOARCH = '386|amd64|arm|arm64|loong64|mips|mipsle|mips64|mips64le|ppc64|ppc64le|riscv64|s390x|sparc64|wasm';

export const go: Preset = {
    description:
        "Go puts a package in a folder, and a new folder is a new package with its own API — so the limits are looser and the advice is about packages. Reads foo_test.go, foo_linux.go and foo_linux_amd64_test.go as foo, and does not count doc.go, the package comment. Go's own guidance: \"There is no 'one type, one file' convention\"; net/http has 17 files and the go command 34. A move proposes a package as Go names them, lowercase in one word (httpserver/), never a keyword.",
    sources: [
        {
            title: 'Go: organizing a Go module: multiple programs in the same repository will typically have separate directories (prog1/main.go)',
            url: 'https://go.dev/doc/modules/layout',
        },
        { title: 'Google Go style: package size', url: 'https://google.github.io/styleguide/go/best-practices' },
        { title: 'The Go blog: organizing Go code', url: 'https://go.dev/blog/organizing-go-code' },
        { title: 'The Go blog: package names are lowercase, single-word', url: 'https://go.dev/blog/package-names' },
        { title: 'The Go specification: keywords', url: 'https://go.dev/ref/spec#Keywords' },
        { title: 'go build: _test.go, testdata and build constraints in file names', url: 'https://pkg.go.dev/cmd/go' },
    ],
    detect: { files: ['go.mod'] },
    config: {
        extends: ['recommended'],
        exclude: [
            'testdata',
            '*.pb.go',
            '*_string.go',
            'zz_generated.*',
            // What the usual generators write: mockgen (mock_*.go), wire, templ, sqlc and grpc-gateway.
            'mock_*.go',
            'wire_gen.go',
            '*_templ.go',
            '*.sql.go',
            '*.pb.gw.go',
        ],
        // doc.go holds the package comment: it describes the folder, it is not one more file in it.
        naming: {
            companions: ['_test$', `_(${GOOS})$`, `_(${GOARCH})$`],
            folderFiles: ['doc.go'],
            folderCase: 'lower',
            reservedWords: [
                'break case chan const continue default defer else fallthrough for',
                'func go goto if import interface map package range return select',
                'struct switch type var',
            ].flatMap(line => line.split(' ')),
        },
        rules: {
            'max-files': [
                'error',
                {
                    max: 30,
                    count: 'modules',
                    hint: 'In Go a folder is a package: split off a part that has its own API, not just to shorten the list.',
                    hintFor: ['*.go'],
                },
            ],
            'prefix-groups': [
                'warn',
                { hint: 'In Go a folder is a package: would they make sense as their own package?', hintFor: ['*.go'] },
            ],
            // Off here, and strict turns it on keeping this: the layout of Go puts one binary per folder.
            'single-file-folders': ['off', { allowed: ['main.go'] }],
        },
    },
};
