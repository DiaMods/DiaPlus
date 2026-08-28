# Official Dia Sync research

Official Dia Sync is not a Dia Mod and is not reachable from Dia Custom.

Dia ships native encrypted Sync, recovery, and device-transfer components, but any modification to its app bundle invalidates The Browser Company's official Apple code signature. Re-signing the clone creates a different client identity. Dia Custom cannot honestly guarantee that the remote account or Sync service will treat that identity as the official app.

The project therefore keeps all Dia/The Browser Company destinations blocked and does not copy official credentials, spoof the official bundle signature, reuse its Keychain access groups, or add network logic intended to conceal the clone. The old experimental runtime, CLI, entitlements, Keychain patches, and exact-host exceptions were removed.

This may be revisited only if Dia publishes an authorized third-party Sync protocol or explicitly supports separately signed clients. Until then, `dia-import` provides a local one-way migration path through Dia's native browser importer.
