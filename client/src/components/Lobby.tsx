import { useState } from "react";
import type { RoomSummary } from "../api";
import type { RoomMode } from "../protocol";

type LobbyProps = {
  rooms: RoomSummary[];
  loading: boolean;
  error: string;
  onRefresh: () => Promise<void>;
  onCreate: (input: { name: string; mode: RoomMode }) => Promise<void>;
  onJoin: (room: RoomSummary) => void;
};

export function Lobby({ rooms, loading, error, onRefresh, onCreate, onJoin }: LobbyProps) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<RoomMode>("emoji");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  return (
    <main className="lobby-shell">
      <header className="lobby-header">
        <div>
          <p className="eyebrow">Sync dashboard</p>
          <h1>FLAM room control</h1>
        </div>
        <span className="header-chip">Instant rooms</span>
      </header>

      <section className="create-room-panel">
        <div>
          <h2>Create room</h2>
          <p>Pick a room activity first. Your display name is asked when you enter.</p>
        </div>
        <form
          className="create-room-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setCreating(true);
            setCreateError("");
            try {
              await onCreate({ name, mode });
              setName("");
            } catch (error) {
              setCreateError(error instanceof Error ? error.message : "Unable to create room.");
            } finally {
              setCreating(false);
            }
          }}
        >
          <input
            aria-label="Room name"
            placeholder="Room name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            minLength={3}
            required
          />
          <div className="mode-picker compact">
            <label>
              <input type="radio" name="createMode" checked={mode === "emoji"} onChange={() => setMode("emoji")} />
              <span>Emoji</span>
            </label>
            <label>
              <input
                type="radio"
                name="createMode"
                checked={mode === "drawing"}
                onChange={() => setMode("drawing")}
              />
              <span>Drawing</span>
            </label>
          </div>
          {createError ? <p className="form-error">{createError}</p> : null}
          <button type="submit" disabled={creating}>
            {creating ? "Creating" : "Create room"}
          </button>
        </form>
      </section>

      <section className="rooms-section">
        <div className="section-title">
          <h2>Existing rooms</h2>
          <button type="button" onClick={() => void onRefresh()}>
            Refresh
          </button>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {loading && rooms.length === 0 ? <p className="muted">Loading rooms...</p> : null}
        {!loading && rooms.length === 0 ? <p className="muted">No rooms yet. Create the first one.</p> : null}
        <div className="room-grid">
          {rooms.map((room) => (
            <article key={room.roomId} className="room-card">
              <div className="room-card-top">
                <div>
                  <h3>{room.name}</h3>
                  <p>{room.roomId}</p>
                </div>
                <span className={`mode-badge ${room.mode}`}>{room.mode === "emoji" ? "Emoji" : "Drawing"}</span>
              </div>
              <div className="active-users">
                <strong>{room.activeUsers.length} active</strong>
                <div>
                  {room.activeUsers.length > 0
                    ? room.activeUsers.map((activeUser) => (
                        <span key={activeUser.clientId} style={{ borderColor: activeUser.color }}>
                          {activeUser.name}
                        </span>
                      ))
                    : "No one inside"}
                </div>
              </div>
              <button type="button" onClick={() => onJoin(room)}>
                Enter room
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
