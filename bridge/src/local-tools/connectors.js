const connectorToolDefinitions = [
  {
    name: "mcp__dia-tools__connector_search",
    description: "Search user-controlled account exports imported into Dia Custom's private local connector store. No query or content is sent to Dia or The Browser Company.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        connectorIDs: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
    source: "local",
  },
  {
    name: "mcp__dia-tools__connector_query",
    description: "Retrieve full local connector records by URIs returned from connector_search. This stays entirely on this Mac.",
    input_schema: {
      type: "object",
      properties: {
        uris: { type: "array", items: { type: "string" }, maxItems: 50 },
        mode: { type: "string", enum: ["summary", "fullContent"] },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["uris"],
      additionalProperties: false,
    },
    source: "local",
  },
  {
    name: "mcp__dia-tools__list_recent_people",
    description: "List people from user-controlled contact or service exports imported into Dia Custom. This local implementation never contacts Dia servers.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
      additionalProperties: true,
    },
    source: "local",
  },
  {
    name: "mcp__dia-tools__lookup_person",
    description: "Look up a person in user-controlled contact or service exports imported into Dia Custom. This local implementation never contacts Dia servers.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        name: { type: "string" },
        email: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      additionalProperties: true,
    },
    source: "local",
  },
];

export function localConnectorTools() {
  return connectorToolDefinitions.map((tool) => ({ ...structuredClone(tool), annotations: { readOnlyHint: true } }));
}

export function isLocalConnectorTool(name) {
  return [
    "connector_search",
    "connector_query",
    "list_recent_people",
    "lookup_person",
    "mcp__dia-tools__connector_search",
    "mcp__dia-tools__connector_query",
    "mcp__dia-tools__list_recent_people",
    "mcp__dia-tools__lookup_person",
  ].includes(name);
}

export async function executeLocalConnectorTool(store, name, input = {}, context = {}) {
  const profileID = context.profileID ?? "Default";
  if (name.endsWith("connector_search")) {
    return store.search({
      profileID,
      query: input.query,
      connectorIDs: input.connectorIDs,
      entryTypes: ["connector"],
      limit: input.limit,
    });
  }
  if (name.endsWith("connector_query")) {
    return store.query({
      profileID,
      uris: input.uris,
      entryTypes: ["connector"],
      mode: input.mode ?? "fullContent",
      limit: input.limit,
    });
  }
  if (name.endsWith("list_recent_people")) {
    return store.recentPeople(input.limit, { profileID });
  }
  if (name.endsWith("lookup_person")) {
    const query = [input.query, input.name, input.email]
      .filter((value) => typeof value === "string" && value.trim())
      .join(" ");
    if (!query) throw new Error("lookup_person requires query, name, or email");
    return store.lookupPerson(query, input.limit, { profileID });
  }
  throw new Error(`unknown local connector tool: ${name}`);
}
