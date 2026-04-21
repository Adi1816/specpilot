import { z } from "zod";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

function extractGeminiResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  const textParts: string[] = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const content = (candidate as Record<string, unknown>).content;
    const parts =
      content && typeof content === "object" && Array.isArray((content as Record<string, unknown>).parts)
        ? ((content as Record<string, unknown>).parts as Array<Record<string, unknown>>)
        : [];

    for (const part of parts) {
      if (typeof part.text === "string" && part.text.trim()) {
        textParts.push(part.text);
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
      const type = typeof record.type === "string" ? record.type : undefined;
      const code = typeof record.code === "string" ? record.code : undefined;
      const status = typeof record.status === "string" ? record.status : undefined;
      const details = [
        type ? `type=${type}` : null,
        code ? `code=${code}` : null,
        status ? `status=${status}` : null,
      ].filter(Boolean);

      return details.length > 0 ? `${message} (${details.join(", ")})` : message;
    }

    return truncateText(rawBody);
  } catch {
    return truncateText(rawBody);
  }
}

function extractJsonText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return null;
}

function sanitizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonSchema(entry));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const result: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "$schema" || key === "default") {
      continue;
    }

    result[key] = sanitizeJsonSchema(entry);
  }

  return result;
}

function buildGeminiResponseSchema<T>(schema: z.ZodType<T>) {
  try {
    return sanitizeJsonSchema(z.toJSONSchema(schema));
  } catch (error) {
    console.warn(
      "[SpecPilot AI] Failed to convert the Zod schema to JSON schema for Gemini structured output.",
      error,
    );
    return null;
  }
}

async function requestOptionalAiText({
  prompt,
  responseMimeType,
  responseSchema,
}: {
  prompt: string;
  responseMimeType?: "application/json";
  responseSchema?: unknown;
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  if (!apiKey) {
    console.warn("[SpecPilot AI] GEMINI_API_KEY is missing. Falling back to deterministic planning.");
    return null;
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: responseMimeType === "application/json" ? 0.2 : 0.4,
            ...(responseMimeType ? { responseMimeType } : {}),
            ...(responseSchema ? { responseJsonSchema: responseSchema } : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      const rawBody = await response.text();
      console.warn(
        `[SpecPilot AI] Gemini request failed with ${response.status} ${response.statusText}. ${extractErrorDetails(rawBody)}`,
      );
      return null;
    }

    const payload = (await response.json()) as unknown;
    const text = extractGeminiResponseText(payload);

    if (!text || text.length === 0) {
      console.warn(
        `[SpecPilot AI] Gemini returned a successful response but no usable output text for model "${model}".`,
      );
      return null;
    }

    return text;
  } catch (error) {
    console.warn("[SpecPilot AI] Gemini request threw an exception. Falling back to deterministic planning.", error);
    return null;
  }
}

export async function generateOptionalAiMemo(prompt: string) {
  return requestOptionalAiText({ prompt });
}

export async function generateOptionalAiJson<T>({
  prompt,
  schema,
  label,
}: {
  prompt: string;
  schema: z.ZodType<T>;
  label: string;
}) {
  const responseSchema = buildGeminiResponseSchema(schema);
  const text = await requestOptionalAiText({
    prompt:
      responseSchema === null
        ? `${prompt}\n\nReturn only one JSON object. Do not use markdown fences.`
        : prompt,
    responseMimeType: responseSchema ? "application/json" : undefined,
    responseSchema: responseSchema ?? undefined,
  });

  if (!text) {
    return null;
  }

  const jsonText = extractJsonText(text) ?? text.trim();
  if (!jsonText) {
    console.warn(`[SpecPilot AI] ${label} response did not contain a valid JSON object.`);
    return null;
  }

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    const validated = schema.safeParse(parsed);

    if (!validated.success) {
      console.warn(
        `[SpecPilot AI] ${label} response failed schema validation. ${validated.error.issues[0]?.message ?? "Unknown validation error."}`,
      );
      return null;
    }

    return validated.data;
  } catch (error) {
    console.warn(`[SpecPilot AI] ${label} response could not be parsed as JSON.`, error);
    return null;
  }
}
