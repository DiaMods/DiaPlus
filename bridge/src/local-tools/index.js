import {
  executeLocalMemoryTool,
  isLocalMemoryTool,
  localMemoryTools,
} from "./memory.js";
import { isLocalWebTool, LocalWebTools } from "./web.js";
import {
  executeLocalConnectorTool,
  isLocalConnectorTool,
  localConnectorTools,
} from "./connectors.js";
import { modEnabled } from "../mods.js";

export class LocalToolRegistry {
  constructor(memoryStore, configStore, {
    webTools = new LocalWebTools(),
    connectorRegistry = null,
  } = {}) {
    this.memoryStore = memoryStore;
    this.configStore = configStore;
    this.webTools = webTools;
    this.connectorRegistry = connectorRegistry;
  }

  async definitions(nativeTools) {
    const config = await this.configStore.load();
    const byName = new Map(nativeTools.map((tool) => [tool.name, tool]));
    if (modEnabled("native-memory") && config.localMemory.enabled) {
      for (const tool of localMemoryTools()) byName.set(tool.name, tool);
    }
    if (modEnabled("local-web") && config.localWeb.enabled) {
      // These exact names replace Dia's server-backed web tools. The model gets
      // the same contract, while execution stays in this localhost process.
      for (const tool of this.webTools.definitions()) byName.set(tool.name, tool);
    }
    if (modEnabled("connectors") && config.localConnectors.enabled) {
      for (const tool of localConnectorTools()) byName.set(tool.name, tool);
    }
    if (modEnabled("live-connectors") && config.localConnectors.enabled &&
        this.connectorRegistry) {
      for (const tool of await this.connectorRegistry.definitions()) byName.set(tool.name, tool);
    }
    return [...byName.values()];
  }

  isLocal(name) {
    return isLocalMemoryTool(name) || isLocalWebTool(name) || isLocalConnectorTool(name) ||
      Boolean(this.connectorRegistry?.isTool(name));
  }

  async execute(call, context = {}) {
    if (isLocalMemoryTool(call.name)) {
      if (!modEnabled("native-memory")) throw new Error("native-memory mod is disabled");
      const config = await this.configStore.load();
      if (!config.localMemory.enabled) throw new Error("local memory is disabled");
      return executeLocalMemoryTool(this.memoryStore, call.name, call.input, context);
    }
    if (isLocalWebTool(call.name)) {
      if (!modEnabled("local-web")) throw new Error("local-web mod is disabled");
      const config = await this.configStore.load();
      if (!config.localWeb.enabled) throw new Error("local public-web tools are disabled");
      return this.webTools.execute(call.name, call.input);
    }
    if (isLocalConnectorTool(call.name)) {
      if (!modEnabled("connectors")) throw new Error("connectors mod is disabled");
      const config = await this.configStore.load();
      if (!config.localConnectors.enabled) throw new Error("local connectors are disabled");
      return executeLocalConnectorTool(this.memoryStore, call.name, call.input);
    }
    if (this.connectorRegistry?.isTool(call.name)) {
      if (!modEnabled("live-connectors")) throw new Error("live-connectors mod is disabled");
      const config = await this.configStore.load();
      if (!config.localConnectors.enabled) throw new Error("local connectors are disabled");
      return this.connectorRegistry.execute(call.name, call.input);
    }
    throw new Error(`unknown local tool: ${call.name}`);
  }
}
