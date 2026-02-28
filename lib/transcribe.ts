// ============================================================
// Deepgram transcription service
// Accepts a Buffer of audio data + MIME type, returns transcript.
// Uses Deepgram Nova-3 model with smart_format for best quality.
// ============================================================

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error("Missing env var: DEEPGRAM_API_KEY");
  }

  const response = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&language=en",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": mimeType,
      },
      body: new Uint8Array(audioBuffer),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Deepgram API error ${response.status}: ${errText}`);
  }

  const json = await response.json();
  const transcript: string =
    json?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

  return transcript.trim();
}
