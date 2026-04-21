function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }

  const output = Array.isArray(record.output) ? record.output : [];
  const textParts: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const content = Array.isArray((item as Record<string, unknown>).content)
      ? ((item as Record<string, unknown>).content as Array<Record<string, unknown>>)
      : [];

    for (const chunk of content) {
      if (chunk.type === "output_text" && typeof chunk.text === "string") {
        textParts.push(chunk.text);
      }
    }
  }

  return textParts.length > 0 ? textParts.join("\n").trim() : null;
}

function truncateText(value: string, limit = 500) {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit)}...`;
}

function extractErrorDetails(rawBody: string) {
  if (!rawBody.trim()) {
    return "No response body returned.";
  }

  try {
    const payload = JSON.parse(rawBody) as Record<string, unknown>;
    const error = payload.error;

    if (error && typeof error === "object") {
      const record = error as Record<string, unknown>;
      const message =
        typeof record.message === "string" ? record.message : truncateText(JSON.stringify(error));
      const type = typeof record.type === "string" ? record.type : "unknown_type";
      const code = typeof record.code === "string" ? record.code : "no_code";

      return `${message} (type=${type}, code=${code})`;
    }

    return truncateText(rawBody);
  } catch {
    return truncateText(rawBody);
  }
}

export async function generateOptionalAiMemo(prompt: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";

  if (!apiKey) {
    console.warn("[SpecPilot AI] OPENAI_API_KEY is missing. Falling back to deterministic risk memo.");
    return null;
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: prompt,
      }),
    });

    if (!response.ok) {
      const rawBody = await response.text();
      console.error(
        `[SpecPilot AI] OpenAI request failed with ${response.status} ${response.statusText}. ${extractErrorDetails(rawBody)}`,
      );
      return null;
    }

    const payload = (await response.json()) as unknown;
    const text = extractResponseText(payload);

    if (!text || text.length === 0) {
      console.warn(
        `[SpecPilot AI] OpenAI returned a successful response but no usable output text for model "${model}". Falling back to deterministic risk memo.`,
      );
      return null;
    }

    console.info(`[SpecPilot AI] OpenAI risk memo generated successfully with model "${model}".`);
    return text;
  } catch (error) {
    console.error(
      "[SpecPilot AI] OpenAI request threw an exception. Falling back to deterministic risk memo.",
      error,
    );
    return null;
  }
}
