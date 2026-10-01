import assert from "node:assert/strict";
import test from "node:test";
import { canonicalNativeAIRoute } from "../src/native-ai-route.js";

test("native AI aliases preserve distinct encryption and chat endpoints", () => {
  for (const route of ["key-exchange", "aiproxy", "audio-transcription"]) {
    assert.equal(canonicalNativeAIRoute("POST", `/ai-service-local-v1/native0/${route}`),
      `/ai-service-local-v1/${route}`);
  }
});

test("native AI aliases do not broaden methods, paths or administration access", () => {
  for (const method of ["GET", "PUT", "DELETE"]) {
    const route = "/ai-service-local-v1/native0/aiproxy";
    assert.equal(canonicalNativeAIRoute(method, route), route);
  }
  for (const route of ["/api/models", "/ai-service-local-v1/native0/api/models",
    "/ai-service-local-v1/native0/aiproxy?admin=true", "/ai-service-local-v1/native0/aiproxy/extra",
    "/ai-service-local-v1/native0", "/ai-service-local-v1/aiproxy"]) {
    assert.equal(canonicalNativeAIRoute("POST", route), route);
  }
});
