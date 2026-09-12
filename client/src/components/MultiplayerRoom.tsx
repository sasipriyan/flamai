import { useEffect, useMemo, useRef, useState } from "react";
import type { RoomSummary } from "../api";
import type { Identity, LocalCursor, ParticipantView } from "../appTypes";
import { COLORS, REACTIONS } from "../constants";
import { createRoom, type ConnectionStatus, type RoomConnection } from "../connection";
import { CursorTrack, interpolationDelayMs } from "../interpolation";
import type { ClientId, DrawPoint, RemoteAction } from "../protocol";
import { startRenderer, type RenderReaction, type RenderStroke } from "../render";
import { roomPath } from "../routes";
import { StatusPill } from "./StatusPill";

type MultiplayerRoomProps = {
  room: RoomSummary;
  displayName: string;
  onLeave: () => void;
};

export function MultiplayerRoom({ room, displayName, onLeave }: MultiplayerRoomProps) {
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [participants, setParticipants] = useState<ParticipantView[]>([]);
  const [selectedReaction, setSelectedReaction] = useState<string>(REACTIONS[0]);
  const [errors, setErrors] = useState<string[]>([]);
  const [localCursor, setLocalCursor] = useState<LocalCursor>();
  const [stats, setStats] = useState({ messages: 0, dropped: 0, rttMs: 0 });
  const [linkCopied, setLinkCopied] = useState(false);

  const identity = useMemo<Identity>(() => getIdentity(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const connectionRef = useRef<RoomConnection | null>(null);
  const tracksRef = useRef(new Map<ClientId, CursorTrack>());
  const participantsRef = useRef<ParticipantView[]>([]);
  const reactionsRef = useRef<RenderReaction[]>([]);
  const strokesRef = useRef<RenderStroke[]>([]);
  const localCursorRef = useRef<LocalCursor | undefined>(undefined);
  const drawingStrokeIdRef = useRef<string | undefined>(undefined);
  const lastDrawPointRef = useRef<DrawPoint | undefined>(undefined);

  useEffect(() => {
    const nextPath = roomPath(room.roomId);
    if (window.location.pathname !== nextPath) {
      window.history.replaceState(null, "", nextPath);
    }
  }, [room.roomId]);

  useEffect(() => {
    const connection = createRoom({
      roomId: room.roomId,
      clientId: identity.clientId,
      name: displayName,
      color: identity.color,
      mode: room.mode,
    });
    connectionRef.current = connection;

    const unsubscribeStatus = connection.onStatus(setStatus);
    const unsubscribePresence = connection.onPresence((nextParticipants) => {
      setParticipants(
        nextParticipants.map((participant) => {
          if (participant.clientId === identity.clientId) return participant;
          let track = tracksRef.current.get(participant.clientId);
          if (!track) {
            track = new CursorTrack();
            tracksRef.current.set(participant.clientId, track);
          }
          if (participant.cursor) {
            track.addSample({
              ...participant.cursor,
              receivedAt: performance.now(),
            });
          }
          return { ...participant, track };
        }),
      );
    });
    const unsubscribeAction = connection.onRemoteAction((clientId, action) => {
      setStats((current) => ({ ...current, messages: current.messages + 1 }));
      if (action.kind === "cursor") {
        const track = ensureTrack(clientId);
        const accepted = track.addSample({ ...action, receivedAt: performance.now() });
        if (!accepted) {
          setStats((current) => ({ ...current, dropped: current.dropped + 1 }));
        }
      } else if (action.kind === "reaction") {
        addReaction(action);
      } else {
        addDraw(action);
      }
    });
    const unsubscribeError = connection.onError((message) => {
      setErrors((current) => [message, ...current].slice(0, 3));
    });
    const unsubscribeLatency = connection.onLatency((rttMs) => {
      setStats((current) => ({ ...current, rttMs }));
    });

    return () => {
      unsubscribeStatus();
      unsubscribePresence();
      unsubscribeAction();
      unsubscribeError();
      unsubscribeLatency();
      connection.close();
      connectionRef.current = null;
      tracksRef.current.clear();
      reactionsRef.current = [];
      strokesRef.current = [];
      drawingStrokeIdRef.current = undefined;
      lastDrawPointRef.current = undefined;
    };
  }, [displayName, identity, room]);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    localCursorRef.current = localCursor;
  }, [localCursor]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    return startRenderer(canvas, () => ({
      participants: [
        ...participantsRef.current
          .filter((participant) => participant.clientId !== identity.clientId)
          .map((participant) => ({
            clientId: participant.clientId,
            name: participant.name,
            color: participant.color,
            track: participant.track,
          })),
        {
          clientId: identity.clientId,
          name: `${displayName} (you)`,
          color: identity.color,
          local: localCursorRef.current,
        },
      ],
      strokes: strokesRef.current,
      reactions: reactionsRef.current,
    }));
  }, [displayName, identity]);

  const remoteCount = participants.filter((participant) => participant.clientId !== identity.clientId).length;
  const roomUrl = `${window.location.origin}${roomPath(room.roomId)}`;
  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.clientId === identity.clientId) return -1;
    if (b.clientId === identity.clientId) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <main className="app-shell">
      <section
        className="stage"
        data-mode={room.mode}
        onPointerDown={(event) => {
          const point = pointFromEvent(event);
          setLocalCursor(point);
          if (room.mode !== "drawing") return;

          event.currentTarget.setPointerCapture(event.pointerId);
          const id = `stroke-${crypto.randomUUID()}`;
          drawingStrokeIdRef.current = id;
          lastDrawPointRef.current = point;
          upsertStroke({
            id,
            color: identity.color,
            points: [point],
            done: false,
          });
          connectionRef.current?.sendDraw(id, [point], false);
        }}
        onPointerMove={(event) => {
          const point = pointFromEvent(event);
          setLocalCursor(point);
          connectionRef.current?.sendCursor(point.x, point.y);

          const strokeId = drawingStrokeIdRef.current;
          if (room.mode === "drawing" && strokeId) {
            const lastPoint = lastDrawPointRef.current;
            if (!lastPoint || pointDistance(lastPoint, point) > 0.004) {
              lastDrawPointRef.current = point;
              appendStrokePoints(strokeId, [point], false);
              connectionRef.current?.sendDraw(strokeId, [point], false);
            }
          }
        }}
        onPointerUp={(event) => {
          const point = pointFromEvent(event);
          finishDrawing(point);
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          const strokeId = drawingStrokeIdRef.current;
          if (strokeId) appendStrokePoints(strokeId, [], true);
          drawingStrokeIdRef.current = undefined;
          lastDrawPointRef.current = undefined;
        }}
        onPointerLeave={() => setLocalCursor(undefined)}
        onClick={(event) => {
          if (room.mode !== "emoji") return;
          const point = pointFromEvent(event);
          connectionRef.current?.sendReaction(point.x, point.y, selectedReaction);
          reactionsRef.current.push({
            id: crypto.randomUUID(),
            emoji: selectedReaction,
            x: point.x,
            y: point.y,
            color: identity.color,
            createdAt: performance.now(),
          });
          trimReactions();
        }}
      >
        <canvas ref={canvasRef} className="stage-canvas" aria-label="Shared cursor canvas" />
        <div className="stage-banner" aria-hidden="true">
          <span>{room.mode === "drawing" ? "Draw here" : "Move here"}</span>
          <strong>{room.mode === "drawing" ? "Drag to sketch" : "Click to react"}</strong>
        </div>
      </section>

      <aside className="control-panel" aria-label="Room controls and presence">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{room.mode === "emoji" ? "Emoji room" : "Drawing room"}</p>
            <h1>{room.name}</h1>
          </div>
          <StatusPill status={status} />
        </div>

        <div className="room-actions">
          <button type="button" onClick={onLeave}>
            Back to rooms
          </button>
          <button type="button" onClick={() => window.open(roomUrl, "_blank", "noopener,noreferrer")}>
            Open tab
          </button>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(roomUrl);
              setLinkCopied(true);
              window.setTimeout(() => setLinkCopied(false), 1400);
            }}
          >
            {linkCopied ? "Copied" : "Copy link"}
          </button>
        </div>

        {room.mode === "emoji" ? (
          <div className="reaction-picker" aria-label="Reaction picker">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className={emoji === selectedReaction ? "selected" : ""}
                onClick={() => setSelectedReaction(emoji)}
                aria-label={`Use ${emoji} reaction`}
              >
                {emoji}
              </button>
            ))}
          </div>
        ) : (
          <div className="draw-tools" aria-label="Drawing tools">
            <span className="draw-preview" style={{ background: identity.color }} />
            <span>Drawing room</span>
            <button type="button" onClick={() => (strokesRef.current = [])}>
              Clear local
            </button>
          </div>
        )}

        <dl className="metrics">
          <div>
            <dt>Clients</dt>
            <dd>{participants.length}</dd>
          </div>
          <div>
            <dt>Remote</dt>
            <dd>{remoteCount}</dd>
          </div>
          <div>
            <dt>Buffer</dt>
            <dd>{interpolationDelayMs()}ms</dd>
          </div>
          <div>
            <dt>Dropped</dt>
            <dd>{stats.dropped}</dd>
          </div>
          <div>
            <dt>RTT</dt>
            <dd>{stats.rttMs > 0 ? `${stats.rttMs}ms` : "..."}</dd>
          </div>
        </dl>

        <section>
          <div className="section-title">
            <h2>Active now</h2>
            <span>{participants.length}</span>
          </div>
          <ul className="presence-list">
            {sortedParticipants.map((participant) => (
              <li
                key={participant.clientId}
                className={participant.clientId === identity.clientId ? "current" : undefined}
              >
                <span className="swatch" style={{ background: participant.color }} />
                <span className="presence-copy">
                  <strong>
                    {participant.clientId === identity.clientId ? `${participant.name} (you)` : participant.name}
                  </strong>
                  <small>{participant.clientId === identity.clientId ? "This tab" : shortClientId(participant.clientId)}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {errors.length > 0 ? (
          <section className="errors" aria-live="polite">
            {errors.map((error, index) => (
              <p key={`${error}-${index}`}>{error}</p>
            ))}
          </section>
        ) : null}
      </aside>
    </main>
  );

  function ensureTrack(clientId: ClientId): CursorTrack {
    let track = tracksRef.current.get(clientId);
    if (!track) {
      track = new CursorTrack();
      tracksRef.current.set(clientId, track);
      setParticipants((current) =>
        current.map((participant) => (participant.clientId === clientId ? { ...participant, track } : participant)),
      );
    }
    return track;
  }

  function addReaction(action: Extract<RemoteAction, { kind: "reaction" }>) {
    const participant = participantsRef.current.find((candidate) => candidate.clientId === action.clientId);
    reactionsRef.current.push({
      id: action.id,
      emoji: action.emoji,
      x: action.x,
      y: action.y,
      color: participant?.color ?? "#ffffff",
      createdAt: performance.now(),
    });
    trimReactions();
  }

  function addDraw(action: Extract<RemoteAction, { kind: "draw" }>) {
    const participant = participantsRef.current.find((candidate) => candidate.clientId === action.clientId);
    const stroke = strokesRef.current.find((candidate) => candidate.id === action.id);

    if (stroke) {
      stroke.points.push(...action.points);
      stroke.done = stroke.done || action.done;
      if (stroke.points.length > 500) {
        stroke.points.splice(0, stroke.points.length - 500);
      }
      return;
    }

    upsertStroke({
      id: action.id,
      color: participant?.color ?? "#ffffff",
      points: [...action.points],
      done: action.done,
    });
  }

  function finishDrawing(point: DrawPoint) {
    const strokeId = drawingStrokeIdRef.current;
    if (!strokeId) return;

    appendStrokePoints(strokeId, [point], true);
    connectionRef.current?.sendDraw(strokeId, [point], true);
    drawingStrokeIdRef.current = undefined;
    lastDrawPointRef.current = undefined;
  }

  function upsertStroke(stroke: RenderStroke) {
    strokesRef.current = [...strokesRef.current.filter((candidate) => candidate.id !== stroke.id), stroke].slice(-80);
  }

  function appendStrokePoints(strokeId: string, points: DrawPoint[], done: boolean) {
    const existing = strokesRef.current.find((stroke) => stroke.id === strokeId);
    if (!existing) return;

    existing.points.push(...points);
    existing.done = existing.done || done;
    if (existing.points.length > 500) {
      existing.points.splice(0, existing.points.length - 500);
    }
  }

  function trimReactions() {
    const cutoff = performance.now() - 1600;
    reactionsRef.current = reactionsRef.current.filter((reaction) => reaction.createdAt >= cutoff).slice(-80);
  }
}

function pointFromEvent(event: { currentTarget: HTMLElement; clientX: number; clientY: number }): LocalCursor {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp01((event.clientX - rect.left) / rect.width),
    y: clamp01((event.clientY - rect.top) / rect.height),
  };
}

function pointDistance(a: DrawPoint, b: DrawPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function shortClientId(clientId: string): string {
  return clientId.replace(/^client-/, "").slice(0, 8);
}

function getIdentity(): Identity {
  return {
    clientId: `client-${crypto.randomUUID()}`,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  };
}
