import {
  executeLocalMemoryTool,
  isLocalMemoryTool,
  localMemoryTools,
} from "./memory.js";

export class LocalToolRegistry {
  constructor(memoryStore, configStore) {
    this.memoryStore = memoryStore;
    this.configStore = configStore;
  }

  async definitions(nativeTools) {
    const config = await this.configStore.load();
    if (!config.localMemory.enabled) return nativeTools;
    const byName = new Map(nativeTools.map((tool) => [tool.name, tool]));
    for (const tool of localMemoryTools()) byName.set(tool.name, tool);
    return [...byName.values()];
  }

  isLocal(name) {
    return isLocalMemoryTool(name);
  }

  async execute(call) {
    if (isLocalMemoryTool(call.name)) {
      return executeLocalMemoryTool(this.memoryStore, call.name, call.input);
    }
    throw new Error(`unknown local tool: ${call.name}`);
  }
}

