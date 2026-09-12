import { useState } from "react";
import type { RoomSummary } from "../api";

type NameDialogProps = {
  room: RoomSummary;
  initialName: string;
  onCancel: () => void;
  onSubmit: (name: string) => void;
};

export function NameDialog({ room, initialName, onCancel, onSubmit }: NameDialogProps) {
  const [name, setName] = useState(initialName);

  return (
    <div className="dialog-backdrop" role="presentation">
      <form
        className="name-dialog"
        aria-label="Enter room name"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(name);
        }}
      >
        <p className="eyebrow">{room.mode === "emoji" ? "Emoji room" : "Drawing room"}</p>
        <h2>Enter "{room.name}"</h2>
        <label>
          Your username
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={2}
            maxLength={32}
            placeholder="Example: Sasi"
            required
          />
        </label>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit">Join room</button>
        </div>
      </form>
    </div>
  );
}
