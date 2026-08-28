#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const app = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  throw new Error("usage: patch-agent-handler.js /path/to/Dia Custom.app");
}
if (basename(dirname(app)) !== "work" || !basename(app).startsWith("Dia Custom")) {
  throw new Error(`refusing to patch a non-clone app: ${app}`);
}

const handler = resolve(
  app,
  "Contents/Resources/agent-server-resources/dist/handler",
);
const binary = await readFile(handler);
const processMonitorSources = [Buffer.from('SL("ps"'), Buffer.from('SL("ls"')];
const processMonitorReplacement = Buffer.from('SL("sh"');
const processMonitorOffsets = [];

for (const source of processMonitorSources) {
  for (let offset = binary.indexOf(source); offset !== -1; offset = binary.indexOf(source, offset + 1)) {
    processMonitorOffsets.push(offset);
  }
}

if (processMonitorOffsets.length !== 0 && processMonitorOffsets.length !== 2) {
  throw new Error(
    `expected exactly two process-monitor calls, found ${processMonitorOffsets.length}`,
  );
}

for (const offset of processMonitorOffsets) {
  processMonitorReplacement.copy(binary, offset);
}

// Keep Dia's real per-context sandbox. Native artifact ingestion relies on
// that boundary when deciding which report directories are trusted. The model
// endpoint is port 8765, so the Seatbelt profile must receive the same port as
// GATEWAY_PORT or it blocks the localhost bridge before the first request.
const handlerPatches = [
  {
    // Repair clones made with the earlier broad sandbox bypass. These changes
    // restore Dia's original profile discovery before the narrower launch-only
    // bypass below is applied.
    before: Buffer.from(
      'process.env.CLAUDE_CODE_SANDBOX_PROFILE && (() => {',
    ),
    after: Buffer.from(
      'process.env.CLAUDE_CODE_SANDBOX_PROFILE || (() => {',
    ),
  },
  {
    before: Buffer.from('return Km(B) ? 0 : null;'),
    after: Buffer.from('return Km(B) ? B : null;'),
  },
  {
    before: Buffer.from('})(), H =false;'),
    after: Buffer.from('})(), H = true;'),
  },
  {
    before: Buffer.from('return Fc(B) ? 0 : null;'),
    after: Buffer.from('return Fc(B) ? B : null;'),
  },
  {
    before: Buffer.from('})(), U =false;'),
    after: Buffer.from('})(), U = true;'),
  },
  {
    // Repair Dia 1.45 clones made with the earlier launch-only bypass.
    before: Buffer.from('let w, L;\n    if (0) {'),
    after: Buffer.from('let w, L;\n    if (V) {'),
  },
  {
    // Repair Dia 1.46 clones made with the earlier launch-only bypass.
    before: Buffer.from('let q, D;\n    if (0) {'),
    after: Buffer.from('let q, D;\n    if (H) {'),
  },
  {
    // Dia 1.46 sandbox-exec parameter. This preserves the binary length.
    before: Buffer.from('`GATEWAY_PORT=${Z}`'),
    after: Buffer.from('`GATEWAY_PORT=8765`'),
  },
  {
    // Dia 1.45 uses a different minified gateway variable.
    before: Buffer.from('`GATEWAY_PORT=${z}`'),
    after: Buffer.from('`GATEWAY_PORT=8765`'),
  },
  {
    // Keep Dia's native context builder and Claude-compatible harness, but
    // send the resulting model request straight to the localhost bridge.
    before: Buffer.from(
      'ANTHROPIC_VERTEX_BASE_URL = `http://127.0.0.1:${H.port}`',
    ),
    after: Buffer.from(
      'ANTHROPIC_VERTEX_BASE_URL = `http://127.0.0.1:${8765  }`',
    ),
  },
  {
    before: Buffer.from(
      'u6.ANTHROPIC_VERTEX_BASE_URL = `http://127.0.0.1:${U.port}`',
    ),
    after: Buffer.from(
      'u6.ANTHROPIC_VERTEX_BASE_URL = `http://127.0.0.1:${8765  }`',
    ),
  },
  (() => {
    // The default Dia agent spec leaves its UI thinking stream disabled even
    // when the model returns Anthropic-compatible thinking blocks. Dia Custom
    // uses that existing UI for local provider activity summaries.
    const before = 'Z.settings?.env?.ENABLE_THINKING_STREAM === "true"';
    return {
      before: Buffer.from(before),
      after: Buffer.from("true".padEnd(before.length, " ")),
    };
  })(),
  (() => {
    const before = 'Q.settings?.env?.ENABLE_THINKING_STREAM === "true"';
    return {
      before: Buffer.from(before),
      after: Buffer.from("true".padEnd(before.length, " ")),
    };
  })(),
  (() => {
    // Dia's stock PreToolUse hook waits for a proprietary Watchtower result.
    // Dia Custom does not use Watchtower, so approve native tools locally and
    // immediately. Dia and the model remain responsible for user confirmation
    // on outward-facing or destructive actions. Pad the replacement so the
    // Bun binary layout is stable.
    const before =
      'Q.onCheck("permission", { tool: C, tool_use_id: N, ...M && { namespace: M }, input: I }, G(R))';
    const localDecision = 'Promise.resolve(\'{"decision":"allow"}\')';
    return {
      before: Buffer.from(before),
      after: Buffer.from(localDecision.padEnd(before.length, " ")),
    };
  })(),
  (() => {
    // Keep notifying Dia's native permission controller so it can associate
    // upload_artifact with the locally streamed tool-safety metadata. The
    // handler does not wait for proprietary Watchtower: its own hook still
    // resolves immediately to the local allow decision.
    const before =
      'J.onCheck("permission", { tool: N, tool_use_id: M, ...I && { namespace: I }, input: P }, K(C)).catch(() => null)';
    const localDecision =
      '(J.onCheck("permission",{tool:N,tool_use_id:M,namespace:I,input:P},K(C)).catch(()=>0),\'{"decision":"allow"}\')';
    return {
      before: Buffer.from(before),
      after: Buffer.from(localDecision.padEnd(before.length, " ")),
    };
  })(),
  (() => {
    // Repair the first build-85823 test patch, whose local JSON template was
    // one quote short and therefore fell back to Dia's deny behavior.
    const remoteBefore =
      'J.onCheck("permission", { tool: N, tool_use_id: M, ...I && { namespace: I }, input: P }, K(C)).catch(() => null)';
    const malformed =
      'Promise.resolve(`{"decision":"${/^(creat|edit|delet|upload|send)/.test(N)?"deny":"allow"}`)';
    const corrected = 'Promise.resolve(\'{"decision":"allow"}\')';
    return {
      before: Buffer.from(malformed.padEnd(remoteBefore.length, " ")),
      after: Buffer.from(corrected.padEnd(remoteBefore.length, " ")),
    };
  })(),
  (() => {
    // Upgrade clones patched before full native tool coverage was enabled.
    const remoteBefore =
      'J.onCheck("permission", { tool: N, tool_use_id: M, ...I && { namespace: I }, input: P }, K(C)).catch(() => null)';
    const conditional =
      'Promise.resolve(`{"decision":"${/^(creat|edit|delet|upload|send)/.test(N)?"deny":"allow"}"}`)';
    const allow = 'Promise.resolve(\'{"decision":"allow"}\')';
    return {
      before: Buffer.from(conditional.padEnd(remoteBefore.length, " ")),
      after: Buffer.from(allow.padEnd(remoteBefore.length, " ")),
    };
  })(),
  (() => {
    // Upgrade 1.46 clones whose earlier patch skipped onCheck completely.
    const remoteBefore =
      'J.onCheck("permission", { tool: N, tool_use_id: M, ...I && { namespace: I }, input: P }, K(C)).catch(() => null)';
    const immediate = 'Promise.resolve(\'{"decision":"allow"}\')';
    const withNativeNotification =
      '(J.onCheck("permission",{tool:N,tool_use_id:M,namespace:I,input:P},K(C)).catch(()=>0),\'{"decision":"allow"}\')';
    return {
      before: Buffer.from(immediate.padEnd(remoteBefore.length, " ")),
      after: Buffer.from(withNativeNotification.padEnd(remoteBefore.length, " ")),
    };
  })(),
  (() => {
    // Keep Dia's native MCP tool lifecycle—and therefore its native activity
    // UI—but execute public web search/fetch through the localhost bridge.
    // Other browser tools retain Dia's original in-process callback.
    const before = `async (j$, C$) => {
          let y = C$?._meta?.["claudecode/toolUseId"], E = typeof y === "string" ? y : undefined;
          if (!D.has(c))
            D.add(c), Dv6(J, T);
          try {
            let u = W?.();
            return { content: [{ type: "text", text: await X.onTool(c, j$, M, u && E ? { ...u, toolUseId: E } : u) }] };
          } catch (u) {
            let A = u instanceof Error ? u.message : String(u);
            return { content: [{ type: "text", text: JSON.stringify({ error: A }) }] };
          }
        }`;
    const localWeb = `async(i,o)=>{if(!D.has(c))D.add(c),Dv6(J,T);try{let m=W?.(),e=o?._meta?.["claudecode/toolUseId"];if(e&&m)m={...m,toolUseId:e};if(M==="dia"&&/^(search_web|fetch_web_content)$/.test(c)){X.onTool(c,i,M,m).catch(()=>0);let r=await fetch("http://127.0.0.1:8765/t",{method:"POST",body:JSON.stringify({n:c,i})}),t=await r.text();if(!r.ok)throw Error(t);return{content:[{type:"text",text:t}]}}return{content:[{type:"text",text:await X.onTool(c,i,M,m)}]}}catch(e){return{content:[{type:"text",text:JSON.stringify({error:String(e)})}]}}}`;
    return {
      before: Buffer.from(before),
      after: Buffer.from(localWeb.padEnd(Buffer.byteLength(before), " ")),
    };
  })(),
  (() => {
    // Upgrade clones whose public-web execution was already local but skipped
    // the native callback that populates Dia's ToolUI presentation models.
    const beforeLength = 537;
    const legacyLocalWeb = `async(j$,C$)=>{let y=C$?._meta?.["claudecode/toolUseId"],E=typeof y==="string"?y:undefined;if(!D.has(c))D.add(c),Dv6(J,T);try{let u=W?.();if(M==="dia"&&/^(search_web|fetch_web_content)$/.test(c)){let r=await fetch("http://127.0.0.1:8765/t",{method:"POST",body:JSON.stringify({n:c,i:j$})}),t=await r.text();if(!r.ok)throw Error(t);return{content:[{type:"text",text:t}]}}return{content:[{type:"text",text:await X.onTool(c,j$,M,u&&E?{...u,toolUseId:E}:u)}]}}catch(u){return{content:[{type:"text",text:JSON.stringify({error:String(u)})}]}}}`;
    const localWeb = `async(i,o)=>{if(!D.has(c))D.add(c),Dv6(J,T);try{let m=W?.(),e=o?._meta?.["claudecode/toolUseId"];if(e&&m)m={...m,toolUseId:e};if(M==="dia"&&/^(search_web|fetch_web_content)$/.test(c)){X.onTool(c,i,M,m).catch(()=>0);let r=await fetch("http://127.0.0.1:8765/t",{method:"POST",body:JSON.stringify({n:c,i})}),t=await r.text();if(!r.ok)throw Error(t);return{content:[{type:"text",text:t}]}}return{content:[{type:"text",text:await X.onTool(c,i,M,m)}]}}catch(e){return{content:[{type:"text",text:JSON.stringify({error:String(e)})}]}}}`;
    return {
      before: Buffer.from(legacyLocalWeb.padEnd(beforeLength, " ")),
      after: Buffer.from(localWeb.padEnd(beforeLength, " ")),
    };
  })(),
];
let handlerPatchCount = 0;

for (const { before, after } of handlerPatches) {
  if (before.length !== after.length) {
    throw new Error("handler patches must preserve byte length");
  }
  const offset = binary.indexOf(before);
  if (offset === -1) {
    continue;
  }
  if (binary.indexOf(before, offset + 1) !== -1) {
    throw new Error(`sandbox patch source is not unique: ${before}`);
  }
  after.copy(binary, offset);
  handlerPatchCount += 1;
}

if (processMonitorOffsets.length === 0 && handlerPatchCount === 0) {
  process.stdout.write("Dia Custom agent handler patches are already applied.\n");
  process.exit(0);
}

await writeFile(handler, binary);
process.stdout.write(
  `Patched ${processMonitorOffsets.length} process-monitor calls and ${handlerPatchCount} handler sites in ${handler}.\n`,
);
