# Dia+ installer

This is a modifier toolkit, not a copy of Dia. It creates Dia+.app locally on your Mac. It uses a verified installed Dia build when available, or downloads the supported build directly from Dia's official servers. Official Dia is not modified.

## Install on another Mac

1. Copy the ZIP to an Apple Silicon Mac running macOS 14 or newer and extract it to a writable folder, such as Downloads.
2. Double-click **Install Dia+.command**. It opens Terminal, downloads official Dia if necessary (about 760 MB), and installs Dia+ in Applications. Allow several minutes and several GB of free space. The installer will gracefully close an existing Dia+ session before replacing it.
3. Configure AI providers in the mod settings. For Codex, install and sign in to the Codex app or CLI on that Mac. Other providers require their own credentials or local service. No accounts, login tokens, browser profiles, or Codex executable are included.

Node, JavaScript dependencies, and precompiled mod helpers are included. You do not need Homebrew, Node, npm, or Xcode to install this supported build. The separate Apple intelligence/media helper requires macOS 27; other providers can run on earlier supported macOS versions. Individual Apple features also depend on device eligibility and downloaded models.

This release is ad-hoc signed and is not notarized. macOS may require you to approve opening the installer or app in System Settings → Privacy & Security. Only approve an installer you trust. Do not disable Gatekeeper globally.

The custom updater checks official Dia releases, verifies their signatures and enabled-mod compatibility, builds locally, and preserves the existing app if preparation fails. If a new Dia release needs different precompiled helpers, install a newer Dia+ modifier release. Remote modifier updates are not configured yet.

The bundle identifier remains `local.rttm.dia`. Existing data stays in `~/Library/Application Support/Dia Custom RTTM` so upgrades preserve profiles and Keychain identity. A prior `Dia Custom RTTM.app` may remain alongside Dia+; use Dia+ after installing. No automatic import of another browser's private profile is performed by this installer; use Dia's import UI.

## Troubleshooting and verification

Keep the Terminal output if installation fails. You can rerun the installer after resolving the reported issue. Use `--download` to always download the pinned official source or `--no-launch` to install without opening the app. Keep the extracted folder until installation finishes; afterward the app carries its runtime and updater tools.

`release-manifest.json` identifies the supported Dia build and inventories every shipped file. `SHA256SUMS.txt` alongside the ZIP provides its SHA-256 digest. Verify with `shasum -a 256` before transferring or installing.
