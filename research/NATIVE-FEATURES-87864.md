# Native feature investigation — build 87864

Status as of October 6, 2026: **parked research references, not usable mods**.
The four manifest entries and investigation tools preserve information for
possible future development only. They remain default-off, blocked pending audit,
and not approved for installation. This note records evidence, not a claim of
working features or a commitment to continue implementing them.

## Browser Use is not the entire requested feature

The native `browser_use` schema describes a sandboxed browser interaction tool.
It requires the `tabs` and `browserUse` capabilities. Its documented page APIs
include navigation, snapshots, locators and actions. The separate Tasks surface
includes `TasksSidebar`, `TasksTopBar`, `TaskListPresentation`,
`TaskSurfaceAccessController` and `TaskExecutionUtilities` in the executable.
Exposing a tool alone does not complete the requested Browser Use & Tasks UI mod.
The old Home extension is only a compatibility stub and is not the task UI.

## October 2 native experiments

- Official executable SHA256:
  `7686865a6a688912df875b738c729f49b246869e3f775f71e93c09af931493f9`.
- Initial overrides reached `NSUserDefaults` as a real string array. This was
  the wrong format: tracing the native reader showed it expects one String,
  split on `|`, with each entry split on `=`. Reader offsets in the exact
  executable above are `0xea8f20` (String read), `0xea8f8c` (`|`), and
  `0xea9150` / `0xea9180` (entry parser / `=`). The research bootstrap and
  supervisor now use that format. The production defaults script is deliberately
  unchanged: correcting its whole historical flag list would also activate
  unrelated developer and Advanced Chat experiments without an audit.
- Native feature client metadata exposes `flags`, `_setOverride`, and
  `removeAllOverrides`; its window presenter requires a typed reducer store,
  not a zero-argument action.
- Generic Swift invocation of the reflected `flags` closure crashed the research
  copy (`inspectFlags` / `callFlags`, 13:13). This was a diagnostic-probe failure,
  not evidence that Browser Use itself crashes. The probe was removed. Do not
  reintroduce an arbitrary generic closure cast across the native return ABI.
- `patch-native-feature-getters.js` identifies one guarded Boolean getter for
  each of the ten candidate flags across all four groups. It checks the exact
  official executable hash, the getter's instruction shape, and the original
  bytes in a baked-isolation research copy before changing its Boolean result.
  These getters have **not** been proven to be the paths used by the task UI.
- Patching the three task getters ran without a crash, but still showed classic
  chat and no native browser tool in the local provider request. Therefore that
  patch is **insufficient**; it must not be promoted as a working mod.
- A disposable `StorableFeatureFlags.json` with version 1 and string-valued
  overrides did not visibly enable the task surface. Its actual consumption,
  version and location remain unverified; do not write it to real profiles.
- After restoring all seven getter patches for the other three feature groups,
  the correct String format exposed the native Apps pane. Advanced Chat could
  be activated in the disposable profile. Native chat showed Fast and, after
  clicking it, “Shifted to Fast.” This proves the UI reacts, not that provider
  reasoning changes: only the title-generation request reached the local
  fixture, while the main response remained pending. Browser Use was off during
  this test, and no Tasks surface is approved.
- The user reported the model picker behind “Ask another question…”. This was
  reproduced when entering Fast/Stop response mode: the native standard toolbar
  collapses but our integration forces its extra picker visible at the left.
  Fixed with typed Swift reads of `configuredUsesResponseCommandGroup` and
  `stopButton` / `activePrimaryCTA` identity. Objective-C encodings for these
  fields are empty, so an encoding-guarded Objective-C read is insufficient.
  The picker is hidden during Fast/Stop and restored afterward. Native QA
  verified no overlap during a response, restoration on the right after Stop,
  and a usable model menu. A compiled Swift regression test covers both states,
  return-to-idle, nil values, changed field types and absent fields. This fix
  does not approve or activate any hidden feature flag.
- Other three groups have guarded getter matches, but no runtime approval.

## Isolation and next investigation

`prepare-browser-use-test.js` now compiles the research path, profile, local-only
policy and provider selection into the research bootstrap. Launches without the
supervisor's environment cannot fall back to the normal profile. The supervisor
rejects older, environment-only copies, disables payload capture, and supports
`pause`/`restart` while retaining its isolated fixture bridge. Mod Manager is
excluded to separate its Settings-window lifecycle from feature investigation.

The October 2 investigation included all four groups. If development resumes,
test them independently, including
disable and restart, and resolve the picker collision and missing main response
routing. Do not bundle model-specific experiment flags. Before future
Browser Use approval, verify a task creation surface, list/session behavior,
native sandbox tool discovery and execution, cancellation and confirmation
boundaries. The generic flag getters are not sufficient evidence.

The normal installation was reopened after testing. Config, credentials and mod
selection hashes were unchanged. No release was published or live app replaced.

## Follow-up isolated testing, October 2

The research bootstrap now enables only the selected group's candidate flags,
explicitly disables the other groups, and does **not** import the historical
Advanced Chat/developer list by default. `--base-flags` remains an explicit
comparative experiment. `configure-feature-test.js` changes a stopped research
copy and preserves its disposable tabs/chats. The supervisor's `bridge` command
reloads the selected mod set before restarting the isolated bridge. Dependency
flags require an explicit allowlisted `--flag=...` argument.

### Chat controls

- With only chat controls selected, classic chat completes through the local
  encrypted AIProxy bridge. The native toolbar exposes **Think more** and
  **Generate**. Think more adds **Shifted to High**, requests regeneration, and
  the regenerated answer completes. A subsequent prompt also completes.
- With all four groups disabled and the app restarted, the same chat's response
  command toolbar disappears and the ordinary composer/model picker returns.
  Thus the control is genuinely flag-dependent, not merely an existing feature.
- Sanitized metadata at the native request boundary shows `reasoning_effort:
  none` for both baseline and regenerated High requests. This is before provider
  adaptation. Actual provider reasoning changes are **not** verified; do not
  describe High as working reasoning. The OpenAI-compatible adapter also does
  not currently forward that field; Codex consumes supported efforts from its
  discovered model catalog. No model-specific flags were enabled.
- The per-chat Personalization label remains visible in the baseline, but its
  toggle behavior is unverified. The existing picker-visibility fix has another
  gap: idle Think more/Generate uses the response-command group too, so it hides
  the custom picker for the whole group, not just during Fast/Stop. This needs
  an audited layout integration before approving chat controls.

### Workspaces/Spaces

- Neither horizontal tabs nor sidebar tabs exposed a separate Space creation
  command in the candidate-flags-only test. Native Profiles settings showed the
  ordinary profile list. Creating a second **disposable** QA profile enabled the
  normal profile selector; this does not prove a new Spaces feature.
- An explicit `spaces-new-top-bar-transition-enabled=true` dependency test still
  did not expose New Space in File or a distinct switching interface.
- A read-only stored-field snapshot **does** confirm native
  `WindowViewModel.stateSubject.currentValue.spacesUIEnabled=true`, a live
  `Spaces.GlobalSpacesController`, and `isSpacesUIEnabledChannel.value=true`.
  Both its `spacesByID` and aggregate stream contain two entries after creating
  two QA profiles; only counts are recorded, not identifiers or stored content.
  Activation reaches native state; it is not correct to conclude the native
  implementation is absent. Creation, switching, persistence and isolation
  remain unverified.

### Split View refinements

- Open Split Pane works with the local page beside a new-tab pane, with separate
  navigation bars. The same bars/layout remain after all experiment flags are
  disabled and the app restarted. This is baseline Split View behavior, **not**
  proof that the refinements added it.
- Native accessibility/button and keyboard actions remain usable. Coordinate
  clicks and drags began failing with `noWindowsAvailable` despite readable AX
  state/screenshots, including after rebinding and resetting computer control.
  Hover-button and drag-preview comparisons are therefore **not completed**.

### Browser Use & Tasks

- The task flags alone still use classic chat. An explicit browser-tool request
  completes, but the provider request contains only local knowledge tools, not
  native `browser_use`. The fixture reports that absence rather than pretending
  to execute a browser action.
- Adding only the Advanced Chat entry dependencies (`clia-agents-chat-enabled`,
  `force-classic-chat-enabled=false`, the visible toggle, and Apps pane redesign)
  exposes Apps activation and a native **Chats** button. After activating
  Advanced Chat in this disposable profile, the main response stalls and later
  shows **Something went wrong**. Only title generation reaches the bridge.
- A scoped system diagnostic reports failure setting up `agent_artifacts`; no
  native handler process was running at inspection. This is a lead, **not an
  established root cause**. Do not bypass database encryption, sandboxing,
  permissions or network isolation to make the test pass. A Chats label is not
  verified task creation, a task list, browser execution or cancellation.

`install-request-probe.js` emits only identifier-shaped control metadata and
top-level key names in the isolated bridge. It excludes messages, system/context,
headers and credentials. `native-state-probe.swift` reads stored reflected fields
only, logging field/type names, Boolean values and collection counts. It never
invokes reflected closures, emits collection items, or writes to a real profile.
Getter inspection now supports `--inspect` without changing the executable.
Mutating research tools validate canonical app/profile paths, the research bundle
identity and exact build before accepting a prepared root. Bridge refresh has a
five-second shutdown deadline rather than waiting indefinitely on a dead child.
Static BL/address scans found no direct callers for the candidate generic getters;
that limited scanner cannot prove they are unused (indirect dispatch is possible).
Their patches are still not a valid runtime activation strategy.

All four production mods remain optional, default-off, blocked pending audit,
and have no approved build. No release or live installation is part of this test.
