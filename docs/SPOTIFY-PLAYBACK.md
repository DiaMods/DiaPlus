# Spotify web playback investigation

Observed October 28, 2026 on macOS, Dia 1.55.0 (89443).

Spotify playback is not fixed. The owner reports repeated track skipping, “Spotify can't play this right now,” and sound stopping after roughly ten seconds. The owner clarified that Safari is the working browser comparison; playback in unmodified Dia is unconfirmed. Spotify desktop/mobile apps also work.

The installed `/Applications/Dia.app` is 1.48.0 (86796), whereas Dia+ is based on 1.55.0. There is no matched-version unmodified-Dia control, so this does not exclude an upstream regression.

## Evidence

- On the earlier installed build, Widevine 4.10.3112.0 was registered and enabled. Spotify attached the CDM, selected an AAC decoder and advanced its timer. These observations do not establish sustained decrypted playback.
- An updater-started 89443 instance registered only one Chromium component. Removing `--disable-component-update` from normal launch paths registered 19 components in a fresh disposable profile, including the existing signed Widevine module. Its official update check reported Up-to-date. Offline profile preflight retains the switch.
- Spotify's `widevine-license/v1/audio/license` requests repeatedly returned HTTP 403 with an empty response body. The response supplies no detailed rejection reason. Do not retain request authentication headers, cookies or licence challenge payloads in diagnostic reports.
- Dia+ modifies ArcCore for its separate Keychain label and sanitized importer source. The resulting framework executable differs from the official one while its bundled `Resources/ArcCore.sig` remains identical. ArcCore includes `VerifyCdmHost_0` and Chromium CDM host-verification code.
- Chromium's macOS [CDM host-file implementation](https://raw.githubusercontent.com/chromium/chromium/main/chrome/common/media/cdm_host_file_path.cc) pairs the framework executable with its resource signature. The [content client](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/chrome/common/chrome_content_client.cc) supplies those host files when host verification is enabled.

Framework integrity is therefore a strong lead, not a confirmed server-provided explanation. Registration repair alone must not be advertised as a Spotify fix. Re-signing a clone with a local certificate does not recreate its publisher's Widevine host signature.

## Boundaries for further work

A legitimate compatibility experiment would preserve the publisher's media framework unchanged and establish whether Keychain separation and sanitized local import can be implemented without modifying that framework. That requires an isolated design and migration test before touching existing encrypted profile data. Preserving the framework alone is not proof that Widevine accepts the rest of a modified application.

Do not substitute another binary's signature, alter verification inputs, disable DRM checks, share the official app's credential namespace, or discard existing profile encryption. Keep the working app/profile and paired rollback backups available throughout testing.

Success requires successful licence responses and sustained audible full-track playback in the installed Dia+, including a later track transition. A moving timer, an attached CDM, initial clear audio or a successful component update is insufficient.

## Separate updater finding

The first component-fix Beta (v0.1.8) failed during preparation with a locked Memory database and was returned to draft before any installation. An older updater client passed live bridge path overrides into candidate validation. v0.1.9 clears inherited mutable paths in the downloaded build entry point, starts staged health with a minimal environment, and gives new updater jobs a controlled environment. Unit tests, a real signed-candidate check and signed manual-installer CI use invalid external path canaries to verify that staging cannot open or modify those stores. This fix is independent of Spotify's licence rejection.
