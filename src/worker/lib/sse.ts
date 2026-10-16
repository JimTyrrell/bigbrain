/** Minimal Server-Sent Events helpers: parse an SSE byte stream, and encode events. */

export interface SSEEvent {
  event: string | null;
  data: string;
}

/** Parse a ReadableStream of SSE bytes into events (handles arbitrary chunk boundaries). */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let event: string | null = null;
  let data: string[] = [];
  const dispatch = (): SSEEvent | null => {
    const out = data.length ? { event, data: data.join("\n") } : null;
    event = null;
    data = [];
    return out;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let nl: number;
      while ((nl = buf.search(/\r?\n|\r/)) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + (buf[nl] === "\r" && buf[nl + 1] === "\n" ? 2 : 1));
        if (line === "") {
          const ev = dispatch();
          if (ev) yield ev;
        } else if (!line.startsWith(":")) {
          const i = line.indexOf(":");
          const field = i < 0 ? line : line.slice(0, i);
          let val = i < 0 ? "" : line.slice(i + 1);
          if (val.startsWith(" ")) val = val.slice(1);
          if (field === "data") data.push(val);
          else if (field === "event") event = val;
        }
      }
    }
    if (buf) {
      const i = buf.indexOf(":");
      if (i >= 0 && buf.slice(0, i) === "data") data.push(buf.slice(i + 1).replace(/^ /, ""));
    }
    const ev = dispatch();
    if (ev) yield ev;
  } finally {
    reader.releaseLock();
  }
}

const enc = new TextEncoder();

export function encodeEvent(event: string, data: unknown): Uint8Array {
  return enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Build a ReadableStream from a string, split into small pieces (handy for tests/fixtures). */
export function streamFromString(s: string, pieceSize = 17): ReadableStream<Uint8Array> {
  const bytes = enc.encode(s);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + pieceSize));
      i += pieceSize;
    },
  });
}
