import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_FRAME_BYTES = 64 * 1024;

export type CloseInfo = {
  code: number;
  reason: string;
};

export class RawWebSocket extends EventEmitter {
  private buffer = Buffer.alloc(0);
  private closed = false;

  constructor(private readonly socket: Duplex) {
    super();
    socket.on("data", (chunk) => this.read(chunk));
    socket.on("close", () => this.emit("close", { code: 1006, reason: "socket closed" } satisfies CloseInfo));
    socket.on("error", (error) => this.emit("error", error));
  }

  sendText(text: string): void {
    this.writeFrame(0x1, Buffer.from(text, "utf8"));
  }

  sendPing(): void {
    this.writeFrame(0x9, Buffer.alloc(0));
  }

  close(code = 1000, reason = "normal closure"): void {
    if (this.closed) return;
    const payload = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
    payload.writeUInt16BE(code, 0);
    payload.write(reason, 2);
    this.writeFrame(0x8, payload);
    this.closed = true;
    setTimeout(() => this.socket.destroy(), 50).unref();
  }

  private read(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const parsed = this.parseFrame();
      if (!parsed) return;

      const { opcode, payload } = parsed;
      if (opcode === 0x1) {
        this.emit("message", payload.toString("utf8"));
      } else if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? payload.subarray(2).toString("utf8") : "";
        this.close(code, reason);
        this.emit("close", { code, reason } satisfies CloseInfo);
      } else if (opcode === 0x9) {
        this.writeFrame(0xA, payload);
      } else if (opcode === 0xA) {
        this.emit("pong");
      }
    }
  }

  private parseFrame(): { opcode: number; payload: Buffer } | undefined {
    const first = this.buffer[0];
    const second = this.buffer[1];
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;

    if (!fin) {
      this.close(1003, "fragmented frames are not supported");
      return undefined;
    }

    if (length === 126) {
      if (this.buffer.length < offset + 2) return undefined;
      length = this.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (this.buffer.length < offset + 8) return undefined;
      const longLength = this.buffer.readBigUInt64BE(offset);
      if (longLength > BigInt(MAX_FRAME_BYTES)) {
        this.close(1009, "frame too large");
        return undefined;
      }
      length = Number(longLength);
      offset += 8;
    }

    if (length > MAX_FRAME_BYTES) {
      this.close(1009, "frame too large");
      return undefined;
    }

    if (!masked) {
      this.close(1002, "client frames must be masked");
      return undefined;
    }

    if (this.buffer.length < offset + 4 + length) return undefined;
    const mask = this.buffer.subarray(offset, offset + 4);
    offset += 4;
    const payload = Buffer.allocUnsafe(length);

    for (let index = 0; index < length; index += 1) {
      payload[index] = this.buffer[offset + index] ^ mask[index % 4];
    }

    this.buffer = this.buffer.subarray(offset + length);
    return { opcode, payload };
  }

  private writeFrame(opcode: number, payload: Buffer): void {
    if (this.closed) return;

    const length = payload.length;
    const headerLength = length < 126 ? 2 : length <= 0xffff ? 4 : 10;
    const header = Buffer.allocUnsafe(headerLength);
    header[0] = 0x80 | opcode;

    if (length < 126) {
      header[1] = length;
    } else if (length <= 0xffff) {
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    this.socket.write(Buffer.concat([header, payload]));
  }
}

export function upgradeToWebSocket(request: IncomingMessage, socket: Duplex): RawWebSocket | undefined {
  const key = request.headers["sec-websocket-key"];
  const upgrade = request.headers.upgrade;

  if (typeof key !== "string" || upgrade?.toLowerCase() !== "websocket") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return undefined;
  }

  const accept = createHash("sha1").update(key + GUID).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n",
    ].join("\r\n"),
  );

  return new RawWebSocket(socket);
}
