import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseClientMessage } from "./protocol.js";

describe("parseClientMessage", () => {
  it("accepts valid cursor messages", () => {
    const result = parseClientMessage(JSON.stringify({ kind: "cursor", seq: 1, t: 10, x: 0.2, y: 0.8 }));
    assert.equal(result.ok, true);
  });

  it("rejects unknown message kinds", () => {
    const result = parseClientMessage(JSON.stringify({ kind: "teleport", x: 0.2, y: 0.8 }));
    assert.equal(result.ok, false);
  });

  it("rejects cursor coordinates outside the shared surface", () => {
    const result = parseClientMessage(JSON.stringify({ kind: "cursor", seq: 1, t: 10, x: 2, y: 0.4 }));
    assert.equal(result.ok, false);
  });

  it("rejects malformed JSON without throwing", () => {
    const result = parseClientMessage("{nope");
    assert.equal(result.ok, false);
  });

  it("accepts valid join messages with a room mode", () => {
    const result = parseClientMessage(
      JSON.stringify({
        kind: "join",
        roomId: "watch-party-42",
        clientId: "client-a",
        name: "Viewer A",
        color: "#4cc9f0",
        mode: "drawing",
      }),
    );
    assert.equal(result.ok, true);
  });

  it("accepts bounded drawing batches", () => {
    const result = parseClientMessage(
      JSON.stringify({
        kind: "draw",
        id: "stroke-1",
        seq: 2,
        t: 20,
        points: [
          { x: 0.2, y: 0.3 },
          { x: 0.25, y: 0.35 },
        ],
        done: false,
      }),
    );
    assert.equal(result.ok, true);
  });

  it("rejects oversized drawing batches", () => {
    const result = parseClientMessage(
      JSON.stringify({
        kind: "draw",
        id: "stroke-1",
        seq: 2,
        t: 20,
        points: Array.from({ length: 13 }, () => ({ x: 0.2, y: 0.3 })),
        done: false,
      }),
    );
    assert.equal(result.ok, false);
  });
});
