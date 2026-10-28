import type { Preset } from '../../config/types.ts';

export const protobuf: Preset = {
    description:
        "Protocol Buffers: user.proto produces user_pb2.py, user_pb2_grpc.py, user_pb.ts, user_grpc_pb.js, user_connect.ts and user_grpc.pb.go, and all of them are the module user. Add it next to the preset of the language that holds the generated code. Proto files follow Buf's layout: a folder per package, one level of folders per package segment.",
    sources: [
        {
            title: 'Protocol Buffers, Python generated code: "The extension (.proto) is replaced with _pb2.py"',
            url: 'https://protobuf.dev/reference/python/python-generated/',
        },
        {
            title: 'Protocol Buffers, Go generated code: "replacing the .proto extension with .pb.go"',
            url: 'https://protobuf.dev/reference/go/go-generated/',
        },
        {
            title: 'Buf style guide: "All files of the same package should be in the same directory"',
            url: 'https://buf.build/docs/best-practices/style-guide/',
        },
    ],
    detect: { files: ['*.proto', 'buf.yaml', 'buf.gen.yaml'] },
    config: {
        extends: ['recommended'],
        // The suffixes of the generators, before the first dot: _pb (JavaScript, TypeScript), _grpc_pb
        // (grpc-tools), _grpc_web_pb (grpc-web), _pb2 and _pb2_grpc (Python), _grpc (Go's user_grpc.pb.go)
        // and _connect (Connect). user.pb.go is already user: the stem stops at the first dot.
        naming: { companions: ['_(?:grpc_web_pb|grpc_pb|pb2_grpc|pb2|pb|grpc|connect)$'] },
    },
};
