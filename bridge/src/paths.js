import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

export const bridgeDirectory = resolve(sourceDirectory, "..");
export const stateDirectory = resolve(bridgeDirectory, ".state");
export const toolCacheDirectory = resolve(bridgeDirectory, "tool-cache");
export const configPath = process.env.DIA_CUSTOM_CONFIG_PATH ??
  resolve(stateDirectory, "config.json");
export const modelCatalogPath = process.env.DIA_CUSTOM_MODEL_CATALOG_PATH ??
  resolve(stateDirectory, "models.json");
export const credentialsPath = process.env.DIA_CUSTOM_CREDENTIALS_PATH ??
  resolve(stateDirectory, "credentials.json");
export const appsStatePath = process.env.DIA_CUSTOM_APPS_STATE_PATH ??
  resolve(stateDirectory, "apps.json");
export const connectorManifestDirectory = process.env.DIA_CUSTOM_CONNECTOR_MANIFESTS ??
  resolve(stateDirectory, "connectors");
export const memoryDatabasePath = process.env.DIA_CUSTOM_MEMORY_PATH ??
  resolve(stateDirectory, "memory.sqlite3");
export const decisionWorkspacePath = process.env.DIA_CUSTOM_DECISION_WORKSPACE ??
  resolve(stateDirectory, "model-workspace");
export const toolCoveragePath = process.env.DIA_CUSTOM_TOOL_COVERAGE_PATH ??
  resolve(stateDirectory, "tool-coverage.json");
export const captureDirectory = process.env.DIA_CUSTOM_CAPTURE_DIR ??
  resolve(stateDirectory, "captures");
export const sessionPath = resolve(stateDirectory, "sessions.json");

export const profileDirectory = process.env.DIA_CUSTOM_PROFILE ?? null;
export const browserHistoryPath = process.env.DIA_CUSTOM_HISTORY_PATH ??
  (profileDirectory
    ? resolve(profileDirectory, "User Data/Default/History")
    : null);

export const appleModelHelperPath = process.env.DIA_CUSTOM_APPLE_MODEL_HELPER ??
  resolve(bridgeDirectory, "bin/DiaCustomAppleModel");
