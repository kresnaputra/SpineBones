# RAG Dataset

This folder stores animation dataset files for the thesis RAG pipeline.

Recommended structure:

- `animations/`: one JSON file per animation clip

Example dataset items:

- `knight-walk.json`
- `knight-idle.json`
- `knight-run.json`

Each file should use the `spinebones-rag-animation` format exported by SpineBones.

The collection contains 30 animation JSON files. Existing clips with
`source.type: "spinebones-export"` come from SpineBones projects. The 12
additional example clips use `source.type: "synthetic"` and have authored
keyframes on a six-bone humanoid reference rig; they are not project exports.
Their `boneMapping` maps semantic roles to that rig's bone names for adaptation.
