# Dia Custom

Dia Custom keeps Dia's native browser and chat interface while routing its AI work through a local bridge. The current provider is Codex, using `gpt-5.6-luna` by default. The original `/Applications/Dia.app` is never modified.

This patch set currently targets Dia **1.45.0 (build 85660)** on Apple silicon. Binary patches deliberately fail when their expected bytes do not match, so a Dia update cannot be patched silently with stale offsets.

## Start here

```sh
./dia-custom doctor
./dia-custom launch
```

Use `./dia-custom help` for every command. If the separate app does not exist yet, create it with:

```sh
./dia-custom build
```

`build --replace` makes a fresh clone and preserves the previous clone beside it. Quit Dia Custom before running `install` or replacing the app.

To select another Codex model for a newly started bridge:

```sh
DIA_CUSTOM_CODEX_MODEL=gpt-5.6-luna ./dia-custom launch
```

The bridge uses the existing Codex login on this Mac. It contacts OpenAI for model inference, but it does not use Dia's AI service. Normal websites remain reachable because this is still a browser.

## Project map

| Path | Purpose |
| --- | --- |
| `dia-custom` | The single command-line entry point |
| `bridge/` | Local HTTP/streaming adapter between Dia and Codex |
| `scripts/` | Reproducible build, install, launch, and diagnostic commands |
| `src/bootstrap/` | Runtime host blocking and local behavior overrides |
| `src/patches/` | Guarded, build-specific binary patchers |
| `src/config/` | Code-signing entitlements for the clone and agent handler |
| `research/` | Build-specific reverse-engineering tools and notes; not runtime code |
| `docs/` | Architecture and current implementation status |

Read [docs/STATUS.md](docs/STATUS.md) for what works and what remains, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the request and tool flow.

## Runtime locations

- App: `../Dia Custom RTTM.app`
- Isolated profile: `~/Library/Application Support/Dia Custom RTTM`
- Deployed bridge and state: `~/Library/Application Support/Dia Custom RTTM/Bridge`
- Runtime diagnostics: `~/Library/Application Support/Dia Custom RTTM/Diagnostics`

Dependencies, compiled objects, captures, logs, packet captures, and backup app binaries are intentionally excluded from Git. Historical development material from the initial investigation is preserved in `../dia-custom-dev-archive-2026-08-20`.
