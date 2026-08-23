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

export class LocalToolRegistry {
  constructor(memoryStore, configStore, { webTools = new LocalWebTools() } = {}) {
    this.memoryStore = memoryStore;
    this.configStore = configStore;
    this.webTools = webTools;
  }

  async definitions(nativeTools) {
    const config = await this.configStore.load();
    const byName = new Map(nativeTools.map((tool) => [tool.name, tool]));
    if (config.localMemory.enabled) {
      for (const tool of localMemoryTools()) byName.set(tool.name, tool);
    }
    if (config.localWeb.enabled) {
      // These exact names replace Dia's server-backed web tools. The model gets
      // the same contract, while execution stays in this localhost process.
      for (const tool of this.webTools.definitions()) byName.set(tool.name, tool);
    }
    if (config.localConnectors.enabled) {
      for (const tool of localConnectorTools()) byName.set(tool.name, tool);
    }
    return [...byName.values()];
  }

  isLocal(name) {
    return isLocalMemoryTool(name) || isLocalWebTool(name) || isLocalConnectorTool(name);
  }

  async execute(call) {
    if (isLocalMemoryTool(call.name)) {
      return executeLocalMemoryTool(this.memoryStore, call.name, call.input);
    }
    if (isLocalWebTool(call.name)) {
      const config = await this.configStore.load();
      if (!config.localWeb.enabled) throw new Error("local public-web tools are disabled");
      return this.webTools.execute(call.name, call.input);
    }
    if (isLocalConnectorTool(call.name)) {
      const config = await this.configStore.load();
      if (!config.localConnectors.enabled) throw new Error("local connectors are disabled");
      return executeLocalConnectorTool(this.memoryStore, call.name, call.input);
    }
    throw new Error(`unknown local tool: ${call.name}`);
  }
}
