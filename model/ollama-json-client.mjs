export async function requestJsonFromOllama({
  url,
  model,
  prompt,
  temperature = 0,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to call Ollama.");
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      format: "json",
      prompt,
      stream: false,
      options: { temperature }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama returned HTTP ${response.status}`);
  }

  const result = await response.json();
  const rawResponse = String(result.response ?? "");

  try {
    return {
      rawResponse,
      parsedResponse: JSON.parse(rawResponse)
    };
  } catch {
    throw new Error(`Invalid JSON response: ${rawResponse}`);
  }
}
