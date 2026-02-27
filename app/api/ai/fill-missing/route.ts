// POST /api/ai/fill-missing
// Takes the current (incomplete) extraction + the user's free-text chat reply,
// asks the AI to fill only the missing fields, and returns an updated extraction.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { AI_CONFIG } from "@/lib/ai.config";

interface FillMissingBody {
  requirementType: string;        // DB enum e.g. "RESTOCK"
  currentExtraction: Record<string, unknown>;
  missingKeys: string[];          // e.g. ["label_name", "expiry_date"]
  userMessage: string;            // free-text reply from the manager
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildFillPrompt(
  requirementType: string,
  currentExtraction: Record<string, unknown>,
  missingKeys: string[],
  userMessage: string
): string {
  const currentDate = today();
  return `You are an AI assistant helping to complete a product requirement form for a darkstore manager.

Today's date is ${currentDate}.
Requirement type: ${requirementType}

The following fields are still missing or null:
${missingKeys.map((k) => `- ${k}`).join("\n")}

Current extracted data (partial):
${JSON.stringify(currentExtraction, null, 2)}

The manager has now provided this additional information:
"${userMessage}"

Your task:
1. Extract values for the missing fields from the manager's message.
2. Return a JSON object containing ONLY the fields that were missing, with their newly extracted values.
3. For expiry_date: if the manager mentions a relative deadline (e.g. "within 3 days", "agle 10 din mein", "kal tak"), compute the absolute date by adding that many days to today (${currentDate}) and return it in YYYY-MM-DD format.
4. If a missing field still cannot be determined from the message, set it to null.
5. For "products": return the full array with at least one object: { "product_name": string, "notes": string | null }.

Only output valid JSON. No markdown, no explanation outside the JSON.

Example output shape (only include keys that were missing):
{
  "label_name": "ASIAN",
  "expiry_date": "2026-03-05"
}`;
}

export async function POST(req: NextRequest) {
  let body: FillMissingBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { requirementType, currentExtraction, missingKeys, userMessage } = body;

  if (!requirementType || !userMessage || !missingKeys?.length) {
    return NextResponse.json({ error: "requirementType, missingKeys, and userMessage are required" }, { status: 400 });
  }

  const prompt = buildFillPrompt(requirementType, currentExtraction, missingKeys, userMessage);

  try {
    let filledText = "";

    if (AI_CONFIG.provider === "anthropic") {
      const apiKey = process.env[AI_CONFIG.apiKeyEnvVar];
      if (!apiKey) throw new Error(`Missing env var: ${AI_CONFIG.apiKeyEnvVar}`);

      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: AI_CONFIG.model,
        max_tokens: 512,
        messages: [{ role: "user", content: prompt }],
      });

      filledText = message.content
        .filter((b) => b.type === "text")
        .map((b) => (b as Anthropic.TextBlock).text)
        .join("");

    } else if (AI_CONFIG.provider === "gemini") {
      const apiKey = process.env[AI_CONFIG.apiKeyEnvVar];
      if (!apiKey) throw new Error(`Missing env var: ${AI_CONFIG.apiKeyEnvVar}`);

      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: AI_CONFIG.model,
        config: { responseMimeType: "application/json", maxOutputTokens: 512 },
        contents: [{ text: prompt }],
      });
      filledText = response.text ?? "";

    } else {
      throw new Error(`Unsupported AI provider: ${AI_CONFIG.provider}`);
    }

    // Strip markdown fences if present
    const cleaned = filledText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

    let filled: Record<string, unknown> = {};
    try {
      filled = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "AI returned non-JSON response", raw: filledText }, { status: 500 });
    }

    // Merge filled values into current extraction
    const updated = { ...currentExtraction, ...filled };

    return NextResponse.json({ data: { updated_extraction: updated, filled_fields: filled } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown AI error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
