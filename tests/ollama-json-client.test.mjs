import assert from "node:assert/strict";
import test from "node:test";

import { requestJsonFromOllama } from "../model/ollama-json-client.mjs";

test("Ollama JSON client owns transport shape and response parsing", async () => {
  let request;
  const result = await requestJsonFromOllama({
    url: "http://localhost:11434/api/generate",
    model: "test-model",
    prompt: "Return JSON",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        json: async () => ({ response: "{\"score\":7}" })
      };
    }
  });

  assert.deepEqual(result, {
    rawResponse: "{\"score\":7}",
    parsedResponse: { score: 7 }
  });
  assert.equal(request.url, "http://localhost:11434/api/generate");
  assert.deepEqual(JSON.parse(request.options.body), {
    model: "test-model",
    format: "json",
    prompt: "Return JSON",
    stream: false,
    options: { temperature: 0 }
  });
});

test("Ollama JSON client reports HTTP and malformed response failures", async () => {
  await assert.rejects(
    requestJsonFromOllama({
      url: "http://localhost",
      model: "test-model",
      prompt: "test",
      fetchImpl: async () => ({ ok: false, status: 503 })
    }),
    /HTTP 503/
  );

  await assert.rejects(
    requestJsonFromOllama({
      url: "http://localhost",
      model: "test-model",
      prompt: "test",
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ response: "not-json" })
      })
    }),
    /Invalid JSON response/
  );
});
