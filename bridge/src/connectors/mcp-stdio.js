import { spawn } from "node:child_process";
import { PersistentMCPClient, maximumMCPMessageBytes } from "./mcp-rpc.js";
import { processEnvironment } from "./local-process.js";

export class MCPStdioClient extends PersistentMCPClient {
  constructor(manifest, { spawnImplementation = spawn, environment = async () => ({}) } = {}) {
    super(manifest);
    this.spawn = spawnImplementation;
    this.environment = environment;
    this.child = null;
  }

  async open() {
    if (this.child) return;
    if (this.closed) throw new Error("Connector transport is closed; reconnect in settings");
    const env = processEnvironment(this.manifest, await this.environment());
    if (this.closed) throw new Error("Connector changed before its process started");
    this.child = this.spawn(this.manifest.command, this.manifest.args, {
      cwd: this.manifest.cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      try {
        buffer += chunk;
        let boundary;
        while ((boundary = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          if (Buffer.byteLength(line) > maximumMCPMessageBytes) throw new Error("MCP response exceeds 4 MiB");
          if (line.trim()) this.receive(JSON.parse(line));
        }
        if (Buffer.byteLength(buffer) > maximumMCPMessageBytes) throw new Error("MCP response exceeds 4 MiB");
      } catch (error) { this.fail(new Error(error instanceof SyntaxError ? "MCP stdout must contain newline-delimited JSON only" : error.message)); this.close(); }
    });
    // Drain stderr without retaining potentially private connector diagnostics.
    this.child.stderr.resume();
    this.child.stdin.on("error", () => { this.fail(new Error("MCP process input closed")); this.close(); });
    this.child.on("error", () => { this.fail(new Error("MCP process could not start; check its executable path")); this.close(); });
    this.child.on("exit", () => { this.fail(new Error("MCP process exited; reconnect in settings")); this.close(); });
  }

  async send(payload) {
    if (!this.child || this.closed) throw new Error("MCP process is not connected");
    const message = `${JSON.stringify(payload)}\n`;
    if (Buffer.byteLength(message) > maximumMCPMessageBytes) throw new Error("MCP request exceeds 4 MiB");
    return new Promise((resolve, reject) => this.child.stdin.write(message, (error) => error ? reject(new Error("MCP process input failed")) : resolve()));
  }

  close() {
    super.close();
    const child = this.child;
    this.child = null;
    if (child) {
      child.stdin.end();
      const terminate = (signal) => {
        try {
          if (process.platform !== "win32" && Number.isInteger(child.pid)) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (error) { if (error.code !== "ESRCH") child.kill(signal); }
      };
      terminate("SIGTERM");
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) terminate("SIGKILL"); }, 1000);
      timer.unref();
    }
  }
}
