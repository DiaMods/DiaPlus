// The native 87864 resolver needs a complete, length-preserving C string.
// Accept only its audited POST routes; never normalize administration paths.
const aliases = new Map([
  ["/ai-service-local-v1/native0/key-exchange", "/ai-service-local-v1/key-exchange"],
  ["/ai-service-local-v1/native0/aiproxy", "/ai-service-local-v1/aiproxy"],
  ["/ai-service-local-v1/native0/audio-transcription", "/ai-service-local-v1/audio-transcription"],
]);

export function canonicalNativeAIRoute(method, url) {
  return method === "POST" ? aliases.get(url) ?? url : url;
}
