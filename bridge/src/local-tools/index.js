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
import { localKnowledgeTools, executeKnowledgeTool, isKnowledgeTool } from "../knowledge.js";

export class LocalToolRegistry {
  constructor(memoryStore, configStore, {
    webTools = new LocalWebTools(),
    connectorRegistry = null,
    knowledgeStore = null,
  } = {}) {
    this.memoryStore = memoryStore;
    this.configStore = configStore;
    this.webTools = webTools;
    this.connectorRegistry = connectorRegistry;
    this.knowledgeStore = knowledgeStore;
  }

  async definitions(nativeTools, { profileID = "Default", readOnlyLocalOnly = false } = {}) {
    const config = await this.configStore.load();
    const byName = new Map((readOnlyLocalOnly ? [] : nativeTools).map((tool) => [tool.name, tool]));
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
      for (const tool of await this.connectorRegistry.definitions(profileID)) byName.set(tool.name, tool);
    }
    if (modEnabled("local-knowledge") && this.knowledgeStore) {
      for (const tool of localKnowledgeTools()) byName.set(tool.name, tool);
    }
    return [...byName.values()].filter((tool) => !readOnlyLocalOnly || (tool.source === "local" && tool.annotations?.readOnlyHint === true));
  }

  isLocal(name) {
    return isLocalMemoryTool(name) || isLocalWebTool(name) || isLocalConnectorTool(name) || isKnowledgeTool(name) ||
      Boolean(this.connectorRegistry?.isTool(name));
  }

  async execute(call, context = {}) {
    if (context.readOnlyLocalOnly) {
      const definitions = await this.definitions([], { profileID: context.profileID, readOnlyLocalOnly: true });
      if (!definitions.some((tool) => tool.name === call.name)) throw new Error("Research and scheduled workflows only permit local read-only tools");
    }
    if (isKnowledgeTool(call.name)) {
      if (!modEnabled("local-knowledge") || !this.knowledgeStore) throw new Error("local-knowledge mod is disabled");
      return executeKnowledgeTool(this.knowledgeStore, call.name, call.input, context);
    }
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
      return executeLocalConnectorTool(this.memoryStore, call.name, call.input, context);
    }
    if (this.connectorRegistry?.isTool(call.name)) {
      if (!modEnabled("live-connectors")) throw new Error("live-connectors mod is disabled");
      const config = await this.configStore.load();
      if (!config.localConnectors.enabled) throw new Error("local connectors are disabled");
      return this.connectorRegistry.execute(call.name, call.input, context);
    }
    throw new Error(`unknown local tool: ${call.name}`);
  }
}
