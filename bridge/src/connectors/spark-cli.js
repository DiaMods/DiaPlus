import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { isAbsolute } from "node:path";

const text = (description) => ({ type: "string", description, minLength: 1, maxLength: 4000 });
const integer = (maximum) => ({ type: "integer", minimum: 1, maximum });
const flag = { type: "boolean" };
const choice = (values) => ({ type: "string", enum: values });
const list = (description) => ({ type: "array", items: text(description), minItems: 1, maxItems: 100 });
const body = (description) => ({ ...text(description), maxLength: 64000, multiline: true });
const order = choice(["ascending", "descending"]);
const range = { tomorrow: flag, week: flag, start: text("Start date, YYYY-MM-DD or YYYY-MM-DDTHH:mm"), end: text("End date, YYYY-MM-DD or YYYY-MM-DDTHH:mm") };
const scope = { in: text("Exact account, folder or calendar identifier discovered using accounts/folders") };
const paging = { page: integer(10000), page_size: integer(100) };
const searchFilter = text("Spark/Gmail-style filter, e.g. from:person@example.com newer_than:7d");

const catalog = [
  ["accounts", "List Spark accounts, calendars, teams and shared inboxes. Start here to discover account identifiers.", {}],
  ["folders", "List Spark folders and labels; use the returned identifiers when browsing mail.", { account: text("Optional account identifier") }, [], "account"],
  ["emails", "Browse email metadata with filters and pagination; use search for topic queries and thread for full bodies.", { folder: text("Folder identifier; default unified Inbox"), filter: searchFilter, ...paging, order, new_senders: flag }, [], "folder"],
  ["search", "Search Spark mail by topic with keyword and semantic search, returning bodies of up to 20 relevant emails.", { about: text("Topic; omit to list matching mail across every folder"), filter: searchFilter, ...scope, ...paging, order }, [], "about"],
  ["thread", "Read a complete email conversation by the message ID returned by emails/search.", { id: text("Message ID or Spark deep link"), download_attachments: flag }, ["id"], "id"],
  ["events", "Read calendar events for today, tomorrow, a week or a date range.", { ...range, ...scope }],
  ["availability", "Find free time, optionally shared with attendee email addresses.", { ...range, attendees: text("Comma-separated attendee emails") }],
  ["contacts", "Find contacts by name or email address.", { query: text("Name or email to look up") }, ["query"], "query"],
  ["team", "List teams or read a team's members, shared inboxes and assignments.", { name: text("Team name") }, [], "name"],
  ["meetings", "List meeting transcript metadata with optional filters and pagination.", { filter: searchFilter, ...paging }],
  ["meeting", "Read a meeting summary; optionally include transcript and notes.", { id: text("Meeting ID"), transcript: flag, notes: flag }, ["id"], "id"],
];

const readCatalog = [
  ["attachment", "Download an attachment and return its local path, MIME type and metadata. Get attachment IDs from thread first.", { id: text("Attachment ID from the thread attachment table") }, ["id"], "id"],
  ["templates", "List saved personal or team message templates.", { personal: flag, team: text("Team name") }],
  ["template", "Inspect a saved message template and its placeholders before using it in a draft.", { id: text("Template ID or name") }, ["id"], "id"],
  ["signatures", "Read the signature each Spark account appends to its drafts.", {}],
];
const emailActions = ["pin", "unpin", "mute", "unmute", "snooze", "unsnooze", "changeReminder", "clearReminder", "setAside", "archive", "moveToInbox", "moveToTrash", "moveToFolder", "attachLabel", "detachLabel", "markAsDone", "markAsUndone", "markAsSeen", "markAsUnseen", "markAsSpam", "markThreadAsPriority", "unmarkThreadAsPriority", "unsubscribe", "changeCategoryPersonal", "changeCategoryNotification", "changeCategoryNewsletters", "shareInTeam", "assign", "delegationComplete", "delegationReopen"];
const contactActions = ["changeCategoryPersonal", "changeCategoryNotification", "changeCategoryNewsletters", "groupEmailsFromContact", "groupEmailsFromContactAndShowInInbox", "ungroupEmailsFromContact", "markContactAsImportant", "unmarkContactAsImportant", "markContactAsPrimary", "unmarkContactAsPrimary", "acceptContact", "blockContact", "acceptDomain", "blockDomain", "enableAutosummaryForContact", "disableAutosummaryForContact"];
const eventFields = { title: text("Title"), start: text("Start date/time including timezone when needed"), end: text("End date/time"), all_day: flag, description: body("Notes"), alerts: text("Comma-separated alert offsets or dates"), location: text("Location"), video_conference: choice(["auto", "meet", "zoom", "teams"]), add: list("Attendee email to invite") };
const writeCatalog = [
  ["draft", "Create or edit a Spark draft, reply, or forward. Does not send. Spark appends the account signature; avoid adding a sign-off. Return the resulting Link to the user for review. Requires Spark triage access.", {
    to: list("Recipient email"), cc: list("CC email"), bcc: list("BCC email"), subject: text("Subject"), body: body("Markdown message body"), account: text("Sending account or shared inbox"),
    edit: text("Existing draft ID"), reply_to: text("Message ID to reply to"), reply_all: text("Message ID for reply-all"), forward: text("Message ID to forward"),
    attach: list("Absolute attachment path readable by Spark"), attach_id: list("Existing attachment ID to copy"), team: text("Team name"), user: list("Teammate email to add"), remove_user: list("Teammate email to remove"),
    allow_send: flag, no_allow_send: flag, unshare: flag, template: text("Template ID or name"), placeholder: list("Manual placeholder as Name=Value"), no_signature: flag,
  }],
  ["delete_draft", "Permanently delete a draft with no undo. Only when the user explicitly requests deleting that draft. Spark refuses scheduled or shared drafts.", { id: text("Draft ID") }, ["id"]],
  ["email_action", "Triage messages: archive, snooze, move, label, mark, share or assign. Actions change the user's mailbox. Sharing, unsubscribe and assignment may notify others; obtain explicit user authorization before those actions. Requires Spark triage access.", { action: choice(emailActions), ids: list("Message ID or Spark deep link"), date: text("Date/time for snooze, reminder or due date"), folder: text("Qualified folder/label from folders"), team: text("Team name"), user: list("Teammate email for sharing"), assignee: text("Teammate email"), comment: body("Assignment comment") }, ["action", "ids"]],
  ["send_draft", "Send or schedule an existing reviewed draft. Sends email externally; call only with explicit user authorization for its recipients and content. If date is supplied, schedules delivery. Requires Spark send access.", { ids: list("Reviewed draft or scheduled message ID"), date: text("Future delivery date/time; omit to send immediately") }, ["ids"]],
  ["unschedule", "Cancel scheduled delivery and return messages to drafts. Re-list Drafts afterward because new IDs are created. Requires Spark send access.", { ids: list("Scheduled message ID") }, ["ids"]],
  ["comment", "Post or edit a comment in a shared mail thread. May automatically share the thread and notify teammates. Requires explicit user authorization and Spark triage access.", { id: text("Thread message ID"), edit: text("Existing comment ID"), body: body("Comment text"), team: text("Team name"), user: list("Teammate email"), attach: list("Absolute attachment path") }, ["body"], "id"],
  ["contact_action", "Change a sender's category, notifications, priority, Gatekeeper or autosummary settings. This affects future mail. Requires Spark triage access.", { action: choice(contactActions), emails: list("Contact email") }, ["action", "emails"]],
  ["create_event", "Create a calendar event. Adding attendees sends invitations, so use only with explicit user authorization for invitees and event details. Requires Spark send access.", { ...eventFields, calendar: text("Account or account:CalendarName") }, ["start"]],
  ["update_event", "Update an event; adding/removing attendees can send invitations or cancellations. Requires explicit user authorization and Spark send access.", { id: text("Event ID"), ...eventFields, remove: list("Attendee email to remove") }, ["id"]],
  ["delete_event", "Delete a calendar event, potentially sending cancellation email. Requires explicit user authorization and Spark send access.", { id: text("Event ID") }, ["id"]],
  ["rsvp_event", "Accept, decline or tentatively accept a calendar invitation and send the RSVP to its organizer. Requires explicit user authorization and Spark send access.", { id: text("Event or invitation message ID"), status: choice(["accept", "decline", "maybe"]) }, ["id", "status"]],
];
const allCatalog = [...catalog, ...readCatalog, ...writeCatalog];

export const sparkTools = allCatalog.map(([name, description, properties, required = []]) => ({
  name,
  description,
  inputSchema: { type: "object", properties: JSON.parse(JSON.stringify(properties), (key, value) => key === "multiline" ? undefined : value), required, additionalProperties: false },
  annotations: { readOnlyHint: !writeCatalog.some((tool) => tool[0] === name), destructiveHint: writeCatalog.some((tool) => tool[0] === name), openWorldHint: true },
}));

export function sparkArguments(name, input = {}) {
  const item = allCatalog.find((row) => row[0] === name);
  if (!item) throw new Error("Unknown Spark tool");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Spark arguments must be an object");
  const [, , properties, required = [], positional] = item;
  for (const key of Object.keys(input)) if (!Object.hasOwn(properties, key)) throw new Error(`Unsupported Spark argument: ${key}`);
  for (const key of required) if (input[key] === undefined) throw new Error(`Spark requires ${key}`);
  function validate(value, schema, key) {
    if (schema.type === "array") {
      if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error(`Invalid Spark ${key}`);
      value.forEach((item) => validate(item, schema.items, key));
    }
    if (schema.type === "string" && (typeof value !== "string" || !value.trim() || value.length > schema.maxLength || (schema.multiline ? /[\0]/ : /[\0\r\n]/).test(value) || value.startsWith("-"))) throw new Error(`Invalid Spark ${key}`);
    if (schema.type === "boolean" && typeof value !== "boolean") throw new Error(`Spark ${key} must be boolean`);
    if (schema.type === "integer" && (!Number.isInteger(value) || value < 1 || value > schema.maximum)) throw new Error(`Invalid Spark ${key}`);
    if (schema.enum && !schema.enum.includes(value)) throw new Error(`Invalid Spark ${key}`);
    if (key === "attach" && typeof value === "string" && !isAbsolute(value)) throw new Error("Spark attachment paths must be absolute");
  }
  for (const [key, value] of Object.entries(input)) validate(value, properties[key], key);
  if ([input.tomorrow, input.week, Boolean(input.start || input.end)].filter(Boolean).length > 1) throw new Error("Choose one Spark calendar range");
  if (["events", "availability"].includes(name) && Boolean(input.start) !== Boolean(input.end)) throw new Error("Spark date ranges require both start and end");
  if (name === "draft") {
    if ([input.edit, input.reply_to, input.reply_all, input.forward].filter(Boolean).length > 1) throw new Error("Choose one draft edit/reply/forward mode");
    if (!input.edit && !input.body && !input.template) throw new Error("New Spark drafts require body or template");
    if (input.allow_send && input.no_allow_send) throw new Error("Choose one shared draft send permission");
    if ((input.remove_user || input.unshare) && !input.edit) throw new Error("Removing collaborators or unsharing requires a draft ID");
    if (input.unshare && Object.keys(input).some((key) => !["edit", "unshare"].includes(key))) throw new Error("Unshare must be a separate draft operation");
  }
  if (name === "comment" && Boolean(input.id) === Boolean(input.edit)) throw new Error("Choose a thread ID or existing comment ID");
  if (name === "email_action") {
    if (["snooze", "changeReminder"].includes(input.action) && !input.date) throw new Error("This Spark action requires date");
    if (["moveToFolder", "attachLabel", "detachLabel"].includes(input.action) && !input.folder) throw new Error("This Spark action requires folder");
    if (input.action === "assign" && !input.assignee) throw new Error("Spark assign requires assignee");
  }
  const aliases = { signatures: ["draft", "signatures"], delete_draft: ["draft", "--delete", input.id],
    email_action: ["action", input.action, ...(input.ids ?? [])], send_draft: ["action", "send", ...(input.ids ?? [])],
    unschedule: ["action", "unschedule", ...(input.ids ?? [])], contact_action: ["contact-action", input.action, ...(input.emails ?? [])],
    create_event: ["event", "create"], update_event: ["event", "update", input.id], delete_event: ["event", "delete", input.id], rsvp_event: ["event", "rsvp", input.id, input.status] };
  const args = aliases[name] ?? [name];
  if (positional && input[positional] !== undefined) args.push(input[positional]);
  const consumed = new Set([positional, ...(aliases[name] ? ["id", "ids", "action", "emails", "status"] : [])]);
  for (const [key, value] of Object.entries(input)) {
    if (consumed.has(key) || value === false) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      args.push(`--${key.replaceAll("_", "-")}`);
      if (item !== true) args.push(String(item));
    }
  }
  if (Buffer.byteLength(JSON.stringify(args)) > 128 * 1024) throw new Error("Spark arguments exceed 128 KiB");
  return args;
}

export function validateSparkCommand(command = "/usr/local/bin/spark") {
  if (typeof command !== "string" || !isAbsolute(command) || /[\0\r\n]/.test(command) || !command.endsWith("/spark")) {
    throw new Error("Spark command must be the absolute path to the spark CLI (for example /usr/local/bin/spark)");
  }
  return command;
}

export async function runSpark(command, args, { execFileImplementation = execFile } = {}) {
  validateSparkCommand(command);
  const environment = Object.fromEntries(["HOME", "USER", "LOGNAME", "TMPDIR", "LANG", "LC_ALL", "PATH"]
    .filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  return new Promise((resolve, reject) => {
    execFileImplementation(command, args, {
      timeout: 30_000, killSignal: "SIGKILL", maxBuffer: 2 * 1024 * 1024,
      env: environment, shell: false, encoding: "utf8",
    }, (error, stdout) => {
      if (error) {
        // CLI stderr may contain account content. Keep it out of status/logs.
        reject(new Error(error.code === "ENOENT"
          ? "Spark CLI was not found. Install Spark's CLI and update its path in settings."
          : error.killed
            ? "Spark timed out. Open Spark Desktop and reconnect."
            : "Spark could not complete the request. Open Spark Desktop, check its Settings > AI Agents account access level, and retry."));
      } else resolve(stdout);
    });
  });
}

export async function checkSpark(command, options) {
  await access(validateSparkCommand(command), constants.X_OK).catch(() => {
    throw new Error("Spark CLI is not executable. Install Spark's CLI and check its path in settings.");
  });
  // Verifies the desktop connection without persisting account details.
  await runSpark(command, ["accounts"], options);
  return { version: (await runSpark(command, ["--version"], options)).trim() };
}

// New write commands were verified against the installed Spark 1.3.1 CLI.
// Older installations retain the original read tools instead of advertising unsupported commands.
export function sparkToolsForVersion(version = "1.0.0") {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (match && (Number(match[1]) > 1 || (Number(match[1]) === 1 && (Number(match[2]) > 3 || (Number(match[2]) === 3 && Number(match[3]) >= 1))))) return sparkTools;
  return sparkTools.filter((tool) => catalog.some((row) => row[0] === tool.name)).map((tool) => {
    const definition = structuredClone(tool);
    if (definition.name === "search") {
      definition.inputSchema.required = ["about"];
      for (const key of ["page", "page_size", "order"]) delete definition.inputSchema.properties[key];
    }
    return definition;
  });
}
