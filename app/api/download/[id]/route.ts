import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/documentStore";
import { generateFilledDocument } from "@/lib/generateDocx";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await Promise.resolve(params);
    const sessionId = resolvedParams.id;

    console.log('[DOWNLOAD API] Received params:', JSON.stringify(resolvedParams, null, 2));
    console.log('[DOWNLOAD API] Extracted sessionId from params:', sessionId);
    console.log('[DOWNLOAD API] sessionId type:', typeof sessionId);
    console.log('[DOWNLOAD API] sessionId length:', sessionId?.length);
    console.log('[DOWNLOAD API] Full URL params:', resolvedParams);

    if (!sessionId) {
      console.log('[DOWNLOAD API] No sessionId provided, returning 400');
      return NextResponse.json(
        { error: "Session ID is required" },
        { status: 400 }
      );
    }

    console.log('[DOWNLOAD API] Looking up session with id:', sessionId);
    const session = await getSession(sessionId);
    console.log('[DOWNLOAD API] Session lookup result:', session ? 'FOUND' : 'NOT FOUND');
    if (session) {
      console.log('[DOWNLOAD API] Found session with id:', session.id);
    } else {
      console.log('[DOWNLOAD API] No session found for id:', sessionId);
    }
    if (!session) {
      return NextResponse.json(
        { error: "Session not found" },
        { status: 404 }
      );
    }

    const allFilled = session.placeholders.every(
      (p) => session.responses[p.key]?.trim()
    );

    if (!allFilled) {
      return NextResponse.json(
        { error: "Document is not yet completed" },
        { status: 400 }
      );
    }

    const buffer = await generateFilledDocument(
      session.originalBuffer,
      session.responses,
      session.placeholders,
      session.originalText
    );
    return new NextResponse(bufferToArrayBuffer(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${session.fileName.replace(/\.docx?$/i, "")}_completed.docx"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Download error:", error);
    return NextResponse.json(
      { error: "Failed to generate document" },
      { status: 500 }
    );
  }
}

function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(buffer);
  return arrayBuffer;
}
