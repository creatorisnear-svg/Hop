import { randomUUID } from "node:crypto";
import { ai } from "@workspace/integrations-gemini-ai";
import { db, generatedImagesTable, type GeneratedImageRow } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { logger } from "./logger";

const IMAGE_MODEL = "gemini-2.5-flash-image";

export interface GeneratedImage {
  id: string;
  prompt: string;
  mimeType: string;
  dataB64: string;
  createdAt: string;
  source: string;
}

function rowOut(r: GeneratedImageRow): GeneratedImage {
  return {
    id: r.id,
    prompt: r.prompt,
    mimeType: r.mimeType,
    dataB64: r.dataB64,
    createdAt: r.createdAt.toISOString(),
    source: r.source,
  };
}

export async function generateImage(prompt: string, source = "user"): Promise<GeneratedImage> {
  const resp = await ai.models.generateContent({
    model: IMAGE_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: {
      responseModalities: ["TEXT", "IMAGE"] as unknown as undefined,
    },
  });

  const candidate = resp.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const imagePart = parts.find(
    (p): p is { inlineData: { data: string; mimeType?: string } } =>
      !!(p as { inlineData?: { data?: string } }).inlineData?.data,
  );
  if (!imagePart?.inlineData?.data) {
    throw new Error("Gemini returned no image data");
  }

  const id = randomUUID();
  const mimeType = imagePart.inlineData.mimeType ?? "image/png";
  const dataB64 = imagePart.inlineData.data;
  const [row] = await db
    .insert(generatedImagesTable)
    .values({ id, prompt, mimeType, dataB64, source })
    .returning();
  logger.info({ id, source }, "image generated");
  return rowOut(row);
}

export async function listImages(limit = 30): Promise<GeneratedImage[]> {
  const rows = await db
    .select()
    .from(generatedImagesTable)
    .orderBy(desc(generatedImagesTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map(rowOut);
}

export async function getImage(id: string): Promise<GeneratedImage | null> {
  const [row] = await db.select().from(generatedImagesTable).where(eq(generatedImagesTable.id, id));
  return row ? rowOut(row) : null;
}

export async function deleteImage(id: string): Promise<boolean> {
  const res = await db.delete(generatedImagesTable).where(eq(generatedImagesTable.id, id)).returning();
  return res.length > 0;
}
