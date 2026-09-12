import type { CursorTrack } from "./interpolation";

export type RenderParticipant = {
  clientId: string;
  name: string;
  color: string;
  track?: CursorTrack;
  local?: {
    x: number;
    y: number;
  };
};

export type RenderReaction = {
  id: string;
  emoji: string;
  x: number;
  y: number;
  color: string;
  createdAt: number;
};

export type RenderStroke = {
  id: string;
  color: string;
  points: Array<{
    x: number;
    y: number;
  }>;
  done: boolean;
};

export type Scene = {
  participants: RenderParticipant[];
  strokes: RenderStroke[];
  reactions: RenderReaction[];
};

export function startRenderer(canvas: HTMLCanvasElement, getScene: () => Scene): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => undefined;

  let frame = 0;
  let disposed = false;

  const resize = () => {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.max(1, Math.floor(height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const draw = () => {
    if (disposed) return;

    const now = performance.now();
    const { width, height } = canvas.getBoundingClientRect();
    context.clearRect(0, 0, width, height);
    drawGrid(context, width, height);

    const scene = getScene();
    for (const stroke of scene.strokes) {
      drawStroke(context, stroke, width, height);
    }

    for (const reaction of scene.reactions) {
      drawReaction(context, reaction, width, height, now);
    }

    for (const participant of scene.participants) {
      const cursor = participant.local ?? participant.track?.getPosition(now);
      if (cursor) {
        const stale = "stale" in cursor && cursor.stale === true;
        drawCursor(context, {
          x: cursor.x * width,
          y: cursor.y * height,
          color: participant.color,
          label: participant.name,
          stale,
        });
      }
    }

    frame = requestAnimationFrame(draw);
  };

  resize();
  window.addEventListener("resize", resize);
  frame = requestAnimationFrame(draw);

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    window.removeEventListener("resize", resize);
  };
}

function drawStroke(context: CanvasRenderingContext2D, stroke: RenderStroke, width: number, height: number) {
  if (stroke.points.length === 0) return;

  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = 5;
  context.strokeStyle = stroke.color;
  context.shadowColor = stroke.color;
  context.shadowBlur = stroke.done ? 0 : 8;
  context.globalAlpha = stroke.done ? 0.78 : 0.92;

  context.beginPath();
  context.moveTo(stroke.points[0].x * width, stroke.points[0].y * height);
  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x * width, point.y * height);
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    context.lineTo(point.x * width + 0.01, point.y * height + 0.01);
  }

  context.stroke();
  context.restore();
}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number) {
  context.save();
  context.strokeStyle = "rgba(255, 255, 255, 0.06)";
  context.lineWidth = 1;

  for (let x = 0; x < width; x += 48) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y < height; y += 48) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.restore();
}

function drawCursor(
  context: CanvasRenderingContext2D,
  cursor: { x: number; y: number; color: string; label: string; stale: boolean },
) {
  context.save();
  context.globalAlpha = cursor.stale ? 0.45 : 1;
  context.translate(cursor.x, cursor.y);

  context.fillStyle = cursor.color;
  context.strokeStyle = "rgba(0, 0, 0, 0.32)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(0, 24);
  context.lineTo(7, 18);
  context.lineTo(12, 31);
  context.lineTo(18, 28);
  context.lineTo(13, 16);
  context.lineTo(23, 16);
  context.closePath();
  context.stroke();
  context.fill();

  context.font = "600 13px Inter, system-ui, sans-serif";
  const labelWidth = Math.min(context.measureText(cursor.label).width + 22, 180);
  context.fillStyle = "rgba(7, 13, 26, 0.88)";
  roundRect(context, 18, 20, labelWidth, 26, 7);
  context.fill();
  context.fillStyle = "#ffffff";
  context.fillText(cursor.label, 29, 38, labelWidth - 18);

  context.restore();
}

function drawReaction(
  context: CanvasRenderingContext2D,
  reaction: RenderReaction,
  width: number,
  height: number,
  now: number,
) {
  const age = now - reaction.createdAt;
  const lifetime = 1200;
  if (age > lifetime) return;

  const progress = age / lifetime;
  const x = reaction.x * width;
  const y = reaction.y * height - progress * 54;

  context.save();
  context.globalAlpha = 1 - progress;
  context.font = `${Math.round(30 + progress * 12)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = reaction.color;
  context.shadowBlur = 18;
  context.fillText(reaction.emoji, x, y);
  context.restore();
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
