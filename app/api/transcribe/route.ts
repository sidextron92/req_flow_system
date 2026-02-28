// POST /api/transcribe
// Accepts a voice note file as multipart/form-data, returns transcript string.

import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/transcribe";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("audio") as File | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  try {
    const transcript = await transcribeAudio(buffer, file.type);
    return NextResponse.json({ transcript });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Transcription failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
