// Decode only the schema's top-level final answer. Tool arguments, nested
// "text" keys and incomplete escape sequences must never appear in chat.
export function partialFinalText(json) {
  const prefix = /^\s*\{\s*"kind"\s*:\s*"final"\s*,\s*"text"\s*:\s*"/.exec(json);
  if (!prefix) return "";
  let raw = "";
  let escaped = false;
  for (const character of json.slice(prefix[0].length)) {
    if (!escaped && character === '"') break;
    raw += character;
    if (escaped) escaped = false;
    else if (character === "\\") escaped = true;
  }
  // JSON.parse handles Unicode and escaping; retain unfinished escape/surrogate
  // sequences for the next snapshot rather than emitting replacement glyphs.
  for (let trim = 0; trim <= Math.min(raw.length, 12); trim += 1) {
    try {
      const text = JSON.parse(`"${raw.slice(0, raw.length - trim)}"`);
      return /[\uD800-\uDBFF]$/.test(text) ? text.slice(0, -1) : text;
    } catch { /* wait for a complete JSON string prefix */ }
  }
  return "";
}

export class FinalTextStream {
  constructor(callback) { this.callback = callback; this.text = ""; }
  async push(snapshot) {
    if (typeof snapshot !== "string") return;
    if (!snapshot.startsWith(this.text)) {
      throw new Error("Provider revised final text after streaming; retry the request");
    }
    const delta = snapshot.slice(this.text.length);
    this.text = snapshot;
    if (delta && this.callback) await this.callback(delta);
  }
}
