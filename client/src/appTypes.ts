import type { RoomSummary } from "./api";
import type { CursorTrack } from "./interpolation";
import type { ParticipantSnapshot } from "./protocol";

export type ParticipantView = ParticipantSnapshot & {
  track?: CursorTrack;
};

export type LocalCursor = {
  x: number;
  y: number;
};

export type Identity = {
  clientId: string;
  color: string;
};

export type JoinDraft = {
  room: RoomSummary;
  name: string;
};
