export type Sample = {
  x: number;
  y: number;
  seq: number;
  t: number;
  receivedAt: number;
};

export type InterpolatedCursor = {
  x: number;
  y: number;
  stale: boolean;
};

const RENDER_DELAY_MS = 100;
const MAX_SAMPLES = 8;
const MAX_EXTRAPOLATION_MS = 180;
const STALE_AFTER_MS = 3500;

export class CursorTrack {
  private samples: Sample[] = [];
  private lastSeq = 0;

  addSample(sample: Sample): boolean {
    if (sample.seq <= this.lastSeq) {
      return false;
    }

    this.lastSeq = sample.seq;
    this.samples.push(sample);
    this.samples.sort((a, b) => a.receivedAt - b.receivedAt);
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
    return true;
  }

  getPosition(now: number): InterpolatedCursor | undefined {
    if (this.samples.length === 0) return undefined;
    const newest = this.samples[this.samples.length - 1];

    if (now - newest.receivedAt > STALE_AFTER_MS) {
      return { x: newest.x, y: newest.y, stale: true };
    }

    if (this.samples.length === 1) {
      return { x: newest.x, y: newest.y, stale: false };
    }

    const renderTime = now - RENDER_DELAY_MS;
    let previous = this.samples[0];
    let next = this.samples[1];

    for (let index = 1; index < this.samples.length; index += 1) {
      if (this.samples[index].receivedAt >= renderTime) {
        previous = this.samples[index - 1];
        next = this.samples[index];
        break;
      }
      previous = this.samples[index - 1];
      next = this.samples[index];
    }

    if (renderTime <= next.receivedAt) {
      const span = Math.max(next.receivedAt - previous.receivedAt, 1);
      const alpha = clamp01((renderTime - previous.receivedAt) / span);
      return {
        x: lerp(previous.x, next.x, alpha),
        y: lerp(previous.y, next.y, alpha),
        stale: false,
      };
    }

    const elapsed = Math.min(renderTime - newest.receivedAt, MAX_EXTRAPOLATION_MS);
    const older = this.samples[this.samples.length - 2];
    const dt = Math.max(newest.receivedAt - older.receivedAt, 1);
    const vx = (newest.x - older.x) / dt;
    const vy = (newest.y - older.y) / dt;

    return {
      x: clamp01(newest.x + vx * elapsed),
      y: clamp01(newest.y + vy * elapsed),
      stale: false,
    };
  }
}

export function interpolationDelayMs(): number {
  return RENDER_DELAY_MS;
}

function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
