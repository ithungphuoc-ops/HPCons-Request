import { NextResponse } from "next/server";
import { putObject } from "@/lib/r2";
import { apiErrorResponse } from "@/lib/http";
import { MAX_UPLOAD_FILE_SIZE } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import type { RequestAttachment } from "@/lib/types";

export const runtime = "nodejs";

const MAX_FILES = 6;
const MAX_FILE_SIZE = MAX_UPLOAD_FILE_SIZE;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const formData = await request.formData();
    const files = formData.getAll("files").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Chưa chọn tệp nào." }, { status: 400 });
    }
    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Chỉ được đính kèm tối đa ${MAX_FILES} tệp mỗi lần.` },
        { status: 400 },
      );
    }
    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `Tệp "${file.name}" vượt quá 10MB.` },
          { status: 400 },
        );
      }
    }

    const uploaded: RequestAttachment[] = [];
    for (const file of files) {
      const path = `requests/${session.uid}/${Date.now()}-${sanitizeFileName(file.name)}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      await putObject(path, buffer, file.type || "application/octet-stream");
      uploaded.push({ name: file.name, path, size: file.size });
    }

    return NextResponse.json({ attachments: uploaded }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
