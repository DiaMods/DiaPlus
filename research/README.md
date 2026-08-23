# Reverse-engineering research

Nothing in this directory is needed to run Dia Custom.

- `tools/` contains small utilities used to inspect ARM64 branches, Swift field metadata, Prompt Tools entry-point shapes, and agent payload logging.
- `notes/` contains build-85660 disassembly and cross-reference findings that explain the guarded offsets in `src/patches/`.

Most notes here describe Dia 1.45.0 (build 85660). Current build steps discover unchanged Prompt Tools entry points by guarded instruction shape, while other private integration points fail closed when their audited structure changes.
