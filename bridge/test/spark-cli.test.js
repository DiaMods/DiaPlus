import assert from "node:assert/strict";
import test from "node:test";
import { runSpark, sparkArguments, sparkTools, sparkToolsForVersion, validateSparkCommand } from "../src/connectors/spark-cli.js";

test("Spark exposes versioned tools with literal, bounded argument lists", () => {
  assert.equal(sparkTools.length, 26);
  assert.equal(sparkToolsForVersion("1.0.0").length, 11);
  assert.equal(sparkToolsForVersion("1.3.1").length, 26);
  assert.ok(sparkTools.every((tool) => tool.inputSchema.additionalProperties === false));
  assert.deepEqual(sparkArguments("search", { about: "release $(touch /tmp/ignored)", filter: "from:team@example.com", in: "work@example.com:Archive" }), ["search", "release $(touch /tmp/ignored)", "--filter", "from:team@example.com", "--in", "work@example.com:Archive"]);
  assert.deepEqual(sparkArguments("emails", { page_size: 20, new_senders: true }), ["emails", "--page-size", "20", "--new-senders"]);
  assert.deepEqual(sparkArguments("meeting", { id: "42", transcript: true, notes: false }), ["meeting", "42", "--transcript"]);
  for (const [name, input] of [["send", {}], ["thread", { id: "--download-attachments" }], ["emails", { page_size: 101 }], ["events", { start: "2026-09-07" }], ["events", { tomorrow: true, week: true }]]) {
    assert.throws(() => sparkArguments(name, input));
  }
  assert.throws(() => validateSparkCommand("spark"), /absolute/);
  assert.throws(() => validateSparkCommand("/bin/sh"), /spark CLI/);
});

test("Spark subprocesses never use a shell or inherit provider secrets", async () => {
  process.env.DIA_TEST_CONNECTOR_SECRET = "not-for-spark";
  try {
    const output = await runSpark("/usr/local/bin/spark", ["accounts"], { execFileImplementation(command, args, options, callback) {
      assert.equal(command, "/usr/local/bin/spark");
      assert.deepEqual(args, ["accounts"]);
      assert.equal(options.shell, false);
      assert.equal(options.timeout, 30000);
      assert.equal(options.env.DIA_TEST_CONNECTOR_SECRET, undefined);
      callback(null, "fixture account");
    } });
    assert.equal(output, "fixture account");
    await assert.rejects(runSpark("/usr/local/bin/spark", ["accounts"], { execFileImplementation(_command, _args, _options, callback) {
      callback(Object.assign(new Error("sensitive account data"), { code: "ENOENT" }), "", "private email");
    } }), (error) => /not found/.test(error.message) && !/private|sensitive/.test(error.message));
  } finally { delete process.env.DIA_TEST_CONNECTOR_SECRET; }
});

test("Spark 1.3.1 covers attachments, drafts, triage, sending and calendar actions without free-form commands", () => {
  assert.deepEqual(sparkArguments("thread", { id: "12", download_attachments: true }), ["thread", "12", "--download-attachments"]);
  assert.deepEqual(sparkArguments("attachment", { id: "42" }), ["attachment", "42"]);
  assert.deepEqual(sparkArguments("draft", { reply_to: "12", body: "Thanks!\n\nHere is the update.", to: ["a@example.com", "b@example.com"] }), ["draft", "--reply-to", "12", "--body", "Thanks!\n\nHere is the update.", "--to", "a@example.com", "--to", "b@example.com"]);
  assert.deepEqual(sparkArguments("email_action", { action: "assign", ids: ["1", "2"], assignee: "a@example.com" }), ["action", "assign", "1", "2", "--assignee", "a@example.com"]);
  assert.deepEqual(sparkArguments("send_draft", { ids: ["1"], date: "2026-10-01T09:00" }), ["action", "send", "1", "--date", "2026-10-01T09:00"]);
  assert.deepEqual(sparkArguments("create_event", { title: "Review", start: "2026-10-01T09:00", add: ["a@example.com"] }), ["event", "create", "--title", "Review", "--start", "2026-10-01T09:00", "--add", "a@example.com"]);
  assert.deepEqual(sparkArguments("rsvp_event", { id: "event-1", status: "accept" }), ["event", "rsvp", "event-1", "accept"]);
  assert.deepEqual(sparkArguments("delete_draft", { id: "12" }), ["draft", "--delete", "12"]);
  assert.equal(sparkTools.find((tool) => tool.name === "send_draft").annotations.readOnlyHint, false);
  for (const [name, input] of [["draft", {}], ["draft", { body: "a", edit: "1", reply_to: "2" }], ["draft", { edit: "1", unshare: true, body: "a" }], ["email_action", { action: "exec", ids: ["1"] }], ["email_action", { action: "assign", ids: ["1"] }], ["send_draft", { ids: ["--help"] }], ["comment", { body: "a" }], ["rsvp_event", { id: "1", status: "yes" }]]) assert.throws(() => sparkArguments(name, input));
});
