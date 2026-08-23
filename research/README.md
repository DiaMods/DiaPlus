# Reverse-engineering research

Nothing in this directory is needed to run Dia Custom.

- `tools/` contains small utilities used to inspect ARM64 branches, Swift field metadata, and agent payload logging.
- `notes/` contains build-85660 disassembly and cross-reference findings that explain the guarded offsets in `src/patches/`.

Most notes here describe Dia 1.45.0 (build 85660); the runtime patch table also records the audited relocations for 1.46.0 (build 85823). Re-run the analysis and update the guards before supporting another build.
