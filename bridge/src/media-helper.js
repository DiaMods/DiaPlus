import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { appleModelHelperPath } from "./paths.js";

// The same bounded JSON-lines channel serves generation and local media
// extraction. Consume lines as they arrive so callbacks provide real streaming.
export async function runAppleHelper(request, { onEvent, helperPath = appleModelHelperPath, timeoutMs = 180_000, signal } = {}) {
  signal?.throwIfAborted();
  await access(helperPath);
  const child = spawn(helperPath, [], { stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let pending = "";
  let bytes = 0;
  let result;
  let failure;
  const cancel = () => {
    failure = signal.reason instanceof Error ? signal.reason : new Error("Apple helper request cancelled");
    child.kill("SIGKILL");
  };
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) cancel();
  const timer = setTimeout(() => {
    failure = new Error("Apple model/media helper timed out");
    child.kill("SIGKILL");
  }, timeoutMs);
  timer.unref();
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
  child.stdin.on("error", (error) => { if (error.code !== "EPIPE") failure = error; });
  const closed = new Promise((resolve) => {
    child.on("error", (error) => { failure = error; });
    child.on("close", resolve);
  });
  child.stdin.end(`${JSON.stringify(request)}\n`);
  async function consume(line) {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.type === "error") throw new Error(event.message ?? "Apple helper failed");
    if (event.type === "result") result = event.value;
    if (onEvent) await onEvent(event);
  }
  try {
    for await (const chunk of child.stdout) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 32 * 1024 * 1024) throw new Error("Apple helper output exceeds 32 MiB");
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        await consume(line);
      }
    }
    if (pending.trim()) await consume(pending);
    const code = await closed;
    if (failure) throw failure;
    if (code !== 0) throw new Error(stderr.trim() || `Apple model helper exited with ${code}`);
    if (result === undefined) throw new Error("Apple helper completed without a result");
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    if (child.exitCode === null) child.kill("SIGKILL");
    await closed;
  }
}
