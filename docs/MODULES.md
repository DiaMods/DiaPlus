# Compatibility modules

`src/config/compatibility-modules.json` is the source of truth for module IDs, defaults, scopes, safety requirements, and rebuild behavior. Profile overrides live in `Bridge/.state/modules.json`; generated state is not committed.

| Module | Primary implementation | Verification / failure boundary |
| --- | --- | --- |
| `identity-isolation` | `scripts/build.sh`, `patch-keychain-label.js`, entitlements | Bundle/profile/Keychain/signature checks in `doctor`; required |
| `network-isolation` | `patch-endpoint.js`, native URL hook, launch host rules, `network-policy.js` | Network-policy tests plus current-run destination log; required |
| `update-blocker` | `install.sh`, `launch.sh`, `supported-dia-builds.json` | Sparkle/feed checks and pre-copy build audit; required |
| `local-ai-routing` | `patch-endpoint.js`, `patch-agent-handler.js`, bridge server/providers | Protocol/provider tests and bridge health; required |
| `account-bypass` | `patch-no-account.js`, anonymous launch defaults | Per-build ARM64 layout check; clean rebuild to remove |
| `model-picker` | native bootstrap model catalog/toolbar functions | Runtime-discovered toolbar plus View-menu fallback |
| `developer-tools` | native bootstrap, local routing/tool pages, browser inspector | Native inspector is webpage-only; local diagnostics fail closed |
| `native-memory` | native Memory reflection shim, `memory.js`, `provider-manager.js` | Memory derivation/profile/privacy/migration tests |
| `reports` | Report controller/uploader patches, `chat-shape.js`, `artifact-safety.js` | Structural patch checks and staged Report test suite |
| `local-web` | `local-tools/web.js`, `network-policy.js` | Public/private/Dia destination and parsing tests |
| `connectors` | `local-tools/connectors.js`, shared Memory index | Entry-type boundary and connector import/search tests |
| `apple-models` | Swift helper and Apple provider adapter | Helper build/status/structured tool fixtures |

## Commands

~~~sh
./dia-custom modules
./dia-custom modules list --json
./dia-custom modules disable <module-id>
./dia-custom modules enable <module-id>
~~~

Runtime and bridge modules take effect after restarting Dia Custom. Build modules must be changed with `./dia-custom build --replace`; `install` refuses to claim that an already-applied binary patch was removed. Required safety/core modules cannot be disabled through this interface.

## Updating for a new Dia release

1. Leave the existing clone installed and let only official Dia update.
2. Run `./dia-custom test`. An unknown official build fails before modification.
3. Audit failing modules separately using the ownership table above.
4. Add the new build to `supported-dia-builds.json` only after every enabled module passes its structural/source tests.
5. Run `./dia-custom update`; the transactional build preserves the previous clone and profile state.

This makes incompatibility explicit. A failed Report audit, for example, does not imply that Memory or the model picker needs to be rewritten.
