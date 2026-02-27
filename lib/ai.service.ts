// ============================================================
// AI Extraction Service
// Supports Anthropic (Claude) and Google Gemini.
// Switch provider + model in lib/ai.config.ts.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG, getSystemPrompt } from "./ai.config";

export interface ExtractionInput {
  requirementType: string;    // DB enum value e.g. "RESTOCK"
  notes: string;
  images: { base64: string; mimeType: string }[];
  systemPrompt?: string;      // Override default if provided
}

export interface ExtractionResult {
  extracted_data: Record<string, unknown>;
  model_used: string;
  raw_text: string;
}

export async function runExtraction(input: ExtractionInput): Promise<ExtractionResult> {
  const { provider } = AI_CONFIG;

  if (provider === "anthropic") return runAnthropicExtraction(input);
  if (provider === "gemini")    return runGeminiExtraction(input);

  throw new Error(`Unsupported AI provider: ${provider}`);
}

// ── Anthropic (Claude) ────────────────────────────────────────

async function runAnthropicExtraction(input: ExtractionInput): Promise<ExtractionResult> {
  const apiKey = process.env[AI_CONFIG.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`Missing env var: ${AI_CONFIG.apiKeyEnvVar}`);
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = input.systemPrompt ?? getSystemPrompt(input.requirementType);

  const userContent: Anthropic.MessageParam["content"] = [
    // Images first (Claude handles multimodal better this way)
    ...input.images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: img.base64,
      },
    })),
    {
      type: "text" as const,
      text: [
        `Requirement Type: ${input.requirementType}`,
        input.notes ? `Manager Notes: ${input.notes}` : "",
        "\nExtract all available information and return as JSON only.",
      ].filter(Boolean).join("\n"),
    },
  ];

  const message = await client.messages.create({
    model: AI_CONFIG.model,
    max_tokens: AI_CONFIG.maxOutputTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const rawText = message.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("");

  // Strip markdown code fences if Claude wraps the JSON
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let extracted_data: Record<string, unknown> = {};
  try {
    extracted_data = JSON.parse(cleaned);
  } catch {
    extracted_data = { parse_error: true, raw: rawText };
  }

  return { extracted_data, model_used: AI_CONFIG.model, raw_text: rawText };
}

// ── Gemini ────────────────────────────────────────────────────

async function runGeminiExtraction(input: ExtractionInput): Promise<ExtractionResult> {
  const apiKey = process.env[AI_CONFIG.apiKeyEnvVar];
  if (!apiKey) {
    throw new Error(`Missing env var: ${AI_CONFIG.apiKeyEnvVar}`);
  }

  const ai = new GoogleGenAI({ apiKey });
  const systemPrompt = input.systemPrompt ?? getSystemPrompt(input.requirementType);

  const textContext = [
    `Requirement Type: ${input.requirementType}`,
    input.notes ? `Manager Notes: ${input.notes}` : "",
    "\nExtract all available information and return as JSON only.",
  ].filter(Boolean).join("\n");

  const contents = [
    { text: textContext },
    ...input.images.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    })),
  ];

  const response = await ai.models.generateContent({
    model: AI_CONFIG.model,
    config: {
      systemInstruction: systemPrompt,
      responseMimeType: "application/json",
      maxOutputTokens: AI_CONFIG.maxOutputTokens,
    },
    contents,
  });

  const rawText = response.text ?? "";

  let extracted_data: Record<string, unknown> = {};
  try {
    extracted_data = JSON.parse(rawText);
  } catch {
    extracted_data = { parse_error: true, raw: rawText };
  }

  return { extracted_data, model_used: AI_CONFIG.model, raw_text: rawText };
}
