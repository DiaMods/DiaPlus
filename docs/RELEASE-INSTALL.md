# Dia+ installer

This is a modifier toolkit, not a copy of Dia. It creates Dia+.app locally on your Mac. It uses a verified installed Dia build when available, or downloads the supported build directly from Dia's official servers. Official Dia is not modified.

## Install on another Mac

1. Copy the ZIP to an Apple Silicon Mac running macOS 14 or newer and extract it to a writable folder, such as Downloads.
2. Double-click **Install Dia+.command**. It opens Terminal, verifies the included signed mod bundle, obtains official Dia if necessary, and asks before installing Dia+ in Applications. Allow several minutes and several GB of free space. Confirm any incompatible optional mods that must be temporarily omitted. The installer gracefully closes an existing Dia+ session before replacing it; cancelling that quit cancels installation. It never force quits or downgrades an installed newer Dia build.
3. Configure AI providers in the mod settings. For Codex, install and sign in to the Codex app or CLI on that Mac. Other providers require their own credentials or local service. No accounts, login tokens, browser profiles, or Codex executable are included.

Node, JavaScript dependencies, and precompiled mod helpers are included. You do not need Homebrew, Node, npm, or Xcode to install this supported build. The separate Apple intelligence/media helper requires macOS 27; other providers can run on earlier supported macOS versions. Individual Apple features also depend on device eligibility and downloaded models.

This release is ad-hoc signed and is not notarized. macOS may require you to approve opening the installer or app in System Settings → Privacy & Security. Only approve an installer you trust. Do not disable Gatekeeper globally.

Manual installation requires **no GitHub account or repository access**. This ZIP contains its own stable installer engine, runtime and release-specific mod bundle. Official Dia may still need an internet download directly from its publisher; private GitHub release downloads are not needed.

In **Updates**, GitHub sign-in is optional. Users with read access to private `DiaMods/DiaPlus` can authorize the DiaMods GitHub App in their browser and use the updater. Access/refresh tokens stay in macOS Keychain; Dia+ never collects GitHub passwords. No App or owner token grants repository access. Users without access can keep using Dia+ and manually install later ZIPs shared by the owner. Losing access or signing out does not disable AI providers, browsing or local data.

Stable is the default; opt into Beta for published private prereleases. Drafts are ignored. **Update mods** rebuilds from verified official source for the same installed Dia build; **Update Dia + mods** requires a bundle audited for the newer official build. Both verify signatures, hashes, native compatibility and current repository access before confirmed installation/restart. Unsupported newer Dia builds stay blocked until audited mods are published. Existing profile/provider/mod choices and paired rollback protections are preserved. Older clients must run this manual installer once to join the new updater.

The bundle identifier remains `local.rttm.dia`. Existing data stays in `~/Library/Application Support/Dia Custom RTTM` so upgrades preserve profiles and Keychain identity. A prior `Dia Custom RTTM.app` may remain alongside Dia+; use Dia+ after installing. No automatic import of another browser's private profile is performed by this installer; use Dia's import UI.

## Troubleshooting and verification

Keep the Terminal output if installation fails. You can rerun the installer after resolving the reported issue. Use `--download` to always download the pinned official source or `--no-launch` to install without opening the app. Automated installations must explicitly pass `--yes`, and `--allow-disable-incompatible` if needed; neither flag overrides required compatibility, archive/signature checks or quit cancellation. Keep the extracted folder until installation finishes; afterward the app carries its runtime and updater tools.

`release-manifest.json` and `release-manifest.sig` authenticate the supported build, release identity, requirements, compatibility results and mod/engine hashes. The mod bundle inventories its files. `SHA256SUMS.txt` alongside the ZIP provides transfer checksums and `SHA256SUMS.sig` authenticates that list with the release public key; check the ZIP with `shasum -a 256` before sharing. Obtain the full installer through a trusted channel; do not substitute an untrusted launcher or signing key.
