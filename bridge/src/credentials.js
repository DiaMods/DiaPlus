import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { credentialsPath } from "./paths.js";

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

function validProviderID(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(value);
}

export class CredentialStore {
  constructor(path = credentialsPath) {
    this.path = path;
    this.value = null;
  }

  async load() {
    if (this.value) return this.value;
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8"));
      this.value = {
        version: 1,
        credentials: Object.fromEntries(Object.entries(raw?.credentials ?? {})
          .filter(([id, secret]) => validProviderID(id) && typeof secret === "string" && secret)),
      };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.value = { version: 1, credentials: {} };
    }
    return this.value;
  }

  async get(provider) {
    if (provider?.apiKeyEnv && process.env[provider.apiKeyEnv]) {
      return process.env[provider.apiKeyEnv];
    }
    const value = await this.load();
    return value.credentials[provider?.id] ?? null;
  }

  async set(providerID, secret) {
    if (!validProviderID(providerID)) throw new Error("invalid credential provider id");
    if (typeof secret !== "string" || secret.trim().length < 4) {
      throw new Error("credential must contain at least four characters");
    }
    const value = await this.load();
    value.credentials[providerID] = secret.trim();
    await atomicWrite(this.path, value);
  }

  async delete(providerID) {
    if (!validProviderID(providerID)) throw new Error("invalid credential provider id");
    const value = await this.load();
    const existed = Object.hasOwn(value.credentials, providerID);
    delete value.credentials[providerID];
    await atomicWrite(this.path, value);
    return existed;
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
