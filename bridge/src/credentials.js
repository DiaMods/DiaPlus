import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { credentialsPath } from "./paths.js";

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

function validRecordID(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._%!-]*$/i.test(value);
}

function validProviderID(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

export class CredentialStore {
  constructor(path = credentialsPath) {
    this.path = path;
    this.value = null;
    this.loading = null;
    this.pendingMutation = Promise.resolve();
  }

  async load() {
    if (this.value) return this.value;
    if (this.loading) return this.loading;
    this.loading = this.loadFile().finally(() => { this.loading = null; });
    return this.loading;
  }

  async loadFile() {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      this.value = {
        version: 1,
        credentials: Object.fromEntries(Object.entries(raw?.credentials ?? {})
          .filter(([id, secret]) => validRecordID(id) && (
            typeof secret === "string" || (secret && typeof secret === "object")
          ))),
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.value = { version: 1, credentials: {} };
    }
    return this.value;
  }

  mutate(operation) {
    const pending = this.pendingMutation.then(async () => {
      const value = structuredClone(await this.load());
      const result = operation(value);
      await atomicWrite(this.path, value);
      this.value = value;
      return result;
    });
    this.pendingMutation = pending.catch(() => {});
    return pending;
  }

  async get(provider) {
    if (provider?.apiKeyEnv && process.env[provider.apiKeyEnv]) {
      return process.env[provider.apiKeyEnv];
    }
    const value = await this.load();
    const secret = value.credentials[provider?.id];
    return typeof secret === "string" ? secret : null;
  }

  async set(providerID, secret) {
    if (!validProviderID(providerID)) throw new Error("invalid credential provider id");
    if (typeof secret !== "string" || secret.trim().length < 4) {
      throw new Error("credential must contain at least four characters");
    }
    return this.mutate((value) => { value.credentials[providerID] = secret.trim(); });
  }

  async getRecord(recordID) {
    if (!validRecordID(recordID)) throw new Error("invalid credential record id");
    const value = await this.load();
    const record = value.credentials[recordID];
    return record && typeof record === "object" ? structuredClone(record) : null;
  }

  async setRecord(recordID, record) {
    if (!validRecordID(recordID)) throw new Error("invalid credential record id");
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error("credential record must be an object");
    }
    const snapshot = structuredClone(record);
    return this.mutate((value) => { value.credentials[recordID] = snapshot; });
  }

  async delete(providerID) {
    if (!validRecordID(providerID)) throw new Error("invalid credential provider id");
    return this.mutate((value) => {
      const existed = Object.hasOwn(value.credentials, providerID);
      delete value.credentials[providerID];
      return existed;
    });
  }

  async status(providers) {
    const value = await this.load();
    return Object.fromEntries(providers.map((provider) => [provider.id, {
      configured: Boolean(
        (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) ||
        value.credentials[provider.id],
      ),
      source: provider.apiKeyEnv && process.env[provider.apiKeyEnv]
        ? `environment:${provider.apiKeyEnv}`
        : value.credentials[provider.id]
          ? "owner-only-file"
          : null,
    }]));
  }
}
