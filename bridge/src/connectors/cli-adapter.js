import { runLocalProcess } from "./local-process.js";

function validateSchema(schema, depth = 0) {
  if (!schema || depth > 1 || !["string", "number", "integer", "boolean", "array"].includes(schema.type)) {
    throw new Error("CLI inputs support scalar values and bounded arrays of scalars");
  }
  const result = { type: schema.type };
  if (schema.description) result.description = String(schema.description).slice(0, 2000);
  if (schema.type === "array") {
    result.items = validateSchema(schema.items, depth + 1);
    if (result.items.type === "array") throw new Error("Nested CLI arrays are not supported");
    result.minItems = schema.minItems ?? 0;
    result.maxItems = schema.maxItems ?? 100;
    if (!Number.isInteger(result.minItems) || !Number.isInteger(result.maxItems) || result.minItems < 0 || result.maxItems < result.minItems || result.maxItems > 100) throw new Error("CLI arrays must contain 0–100 values");
  }
  if (schema.type === "string") {
    result.minLength = schema.minLength ?? 0;
    result.maxLength = schema.maxLength ?? 16000;
    if (!Number.isInteger(result.minLength) || !Number.isInteger(result.maxLength) || result.minLength < 0 || result.maxLength < result.minLength || result.maxLength > 64000) throw new Error("CLI strings must be bounded to 64000 characters");
  }
  for (const key of ["minimum", "maximum"]) if (schema[key] !== undefined) {
    if (!Number.isFinite(schema[key])) throw new Error(`CLI input ${key} must be finite`);
    result[key] = schema[key];
  }
  if (schema.enum !== undefined) {
    if (!Array.isArray(schema.enum) || !schema.enum.length || schema.enum.length > 100 || schema.enum.some((item) => !["string", "number", "boolean"].includes(typeof item))) throw new Error("Invalid CLI input enum");
    result.enum = [...schema.enum];
  }
  return result;
}

export function validateCLITools(tools) {
  if (!Array.isArray(tools) || !tools.length || tools.length > 100) throw new Error("CLI connectors require 1–100 tool definitions");
  const names = new Set();
  return tools.map((tool) => {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(tool?.name) || names.has(tool.name)) throw new Error("CLI tool names must be unique identifiers");
    names.add(tool.name);
    const schema = tool.inputSchema ?? { type: "object", properties: {} };
    if (schema.type !== "object" || !schema.properties || typeof schema.properties !== "object" || Array.isArray(schema.properties) || Object.keys(schema.properties).length > 100) throw new Error("CLI inputSchema must define object properties");
    const properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(key)) throw new Error("Invalid CLI input property name");
      return [key, validateSchema(value)];
    }));
    const required = schema.required ?? [];
    if (!Array.isArray(required) || required.some((key) => !Object.hasOwn(properties, key))) throw new Error("CLI required inputs must exist in properties");
    if (!Array.isArray(tool.args) || tool.args.length > 128) throw new Error("CLI tools require an args template array");
    const args = tool.args.map((part) => {
      if (typeof part === "string" && part.length <= 16000 && !part.includes("\0")) return part;
      if (!part || !Object.hasOwn(properties, part.input)) throw new Error("CLI argument templates must refer to a declared input");
      if (part.flag !== undefined && (typeof part.flag !== "string" || !/^--?[a-zA-Z][a-zA-Z0-9_-]*$/.test(part.flag))) throw new Error("Invalid CLI argument flag");
      return { input: part.input, ...(part.flag ? { flag: part.flag } : {}), allowLeadingDash: part.allowLeadingDash === true };
    });
    return { name: tool.name, description: String(tool.description ?? tool.name).slice(0, 4000),
      inputSchema: { type: "object", properties, required: [...required], additionalProperties: false }, args,
      output: tool.output === "json" ? "json" : "text",
      annotations: { readOnlyHint: tool.annotations?.readOnlyHint === true,
        destructiveHint: tool.annotations?.readOnlyHint === true ? false : tool.annotations?.destructiveHint !== false,
        openWorldHint: true } };
  });
}

function checkValue(value, schema, key) {
  if (schema.type === "array") {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) throw new Error(`Invalid CLI ${key} array`);
    value.forEach((item) => checkValue(item, schema.items, key));
  } else if (schema.type === "string") {
    if (typeof value !== "string" || value.includes("\0") || value.length < schema.minLength || value.length > schema.maxLength) throw new Error(`Invalid CLI ${key} string`);
  } else if (schema.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`Invalid CLI ${key} boolean`);
  } else if (typeof value !== "number" || !Number.isFinite(value) || (schema.type === "integer" && !Number.isInteger(value)) ||
    (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) throw new Error(`Invalid CLI ${key} number`);
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid CLI ${key} choice`);
}

export function cliArguments(manifest, name, input = {}) {
  const tool = manifest.tools.find((item) => item.name === name);
  if (!tool) throw new Error("Unknown CLI connector tool");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("CLI arguments must be an object");
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(tool.inputSchema.properties, key)) throw new Error(`Unsupported CLI argument: ${key}`);
    checkValue(input[key], tool.inputSchema.properties[key], key);
  }
  for (const key of tool.inputSchema.required) if (!Object.hasOwn(input, key)) throw new Error(`CLI requires ${key}`);
  const args = [...manifest.args];
  for (const part of tool.args) {
    if (typeof part === "string") { args.push(part); continue; }
    const value = input[part.input];
    if (value === undefined || value === false) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      if (!part.allowLeadingDash && String(item).startsWith("-")) throw new Error(`CLI ${part.input} cannot start with a dash`);
      if (part.flag) args.push(part.flag);
      if (item !== true || !part.flag) args.push(String(item));
    }
  }
  if (args.length > 512 || Buffer.byteLength(JSON.stringify(args)) > 128 * 1024) throw new Error("CLI argument list is too large");
  return args;
}

export async function executeCLI(manifest, name, input, options = {}) {
  const tool = manifest.tools.find((item) => item.name === name);
  const stdout = await (options.runner ?? runLocalProcess)(manifest, cliArguments(manifest, name, input), options);
  if (tool.output === "json") {
    const result = JSON.parse(stdout);
    return { structuredContent: result, content: [{ type: "text", text: JSON.stringify(result) }] };
  }
  return { content: [{ type: "text", text: stdout }] };
}
