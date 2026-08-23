import assert from "node:assert/strict";
import test from "node:test";
import {
  assertPublicWebURL,
  isPrivateAddress,
  LocalWebTools,
  parseDuckDuckGoResults,
} from "../src/local-tools/web.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("public web boundary rejects private, reserved, and Dia destinations", async () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("192.168.1.10"), true);
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("::ffff:7f00:1"), true);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
  await assert.rejects(assertPublicWebURL("http://127.0.0.1/admin", publicLookup), /private or reserved/);
  await assert.rejects(assertPublicWebURL("https://api.diabrowser.engineering/x", publicLookup), /refuse destination/);
  assert.equal((await assertPublicWebURL("https://example.com/x", publicLookup)).hostname, "example.com");
});

test("parses public search results and unwraps DuckDuckGo redirect URLs", () => {
  const results = parseDuckDuckGoResults(`
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fstory">Example &amp; Story</a>
      <a class="result__snippet">A useful <b>public</b> result.</a>
    </div>
  `);
  assert.deepEqual(results, [{
    title: "Example & Story",
    url: "https://example.com/story",
    snippet: "A useful public result.",
  }]);
});

test("search and fetch execute in the local bridge with bounded readable text", async () => {
  const calls = [];
  const web = new LocalWebTools({
    lookupImplementation: publicLookup,
    fetchImplementation: async (url) => {
      calls.push(String(url));
      if (String(url).includes("duckduckgo.com")) {
        return new Response(`
          <a class="result__a" href="https://example.com/page">Example page</a>
          <span class="result__snippet">Fixture result</span>
        `, { headers: { "content-type": "text/html" } });
      }
      return new Response(`<!doctype html><head><title>Fixture</title></head><main><h1>Hello</h1><script>secret()</script><p>Readable body.</p></main>`, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });
  const searched = await web.execute("mcp__dia-tools__search_web", { queries: ["fixture"] });
  assert.equal(searched.searches[0].results[0].url, "https://example.com/page");

  const fetched = await web.execute("mcp__dia-tools__fetch_web_content", {
    urls: ["https://example.com/page"],
  });
  assert.equal(fetched.pages[0].title, "Fixture");
  assert.match(fetched.pages[0].content, /Hello\n+Readable body/);
  assert.doesNotMatch(fetched.pages[0].content, /secret/);
  assert.equal(calls.length, 2);
});
