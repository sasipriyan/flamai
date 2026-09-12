import { useEffect, useMemo, useState } from "react";
import { createStoredRoom, getRooms, type RoomSummary } from "./api";
import type { JoinDraft } from "./appTypes";
import { Lobby } from "./components/Lobby";
import { MultiplayerRoom } from "./components/MultiplayerRoom";
import { NameDialog } from "./components/NameDialog";
import { currentRoute, getRoomIdFromPath, isDashboardAlias, navigateTo, roomPath } from "./routes";

export default function App() {
  const [route, setRoute] = useState(() => currentRoute());
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsError, setRoomsError] = useState("");
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [activeRoom, setActiveRoom] = useState<RoomSummary>();
  const [displayName, setDisplayName] = useState("");
  const [joinDraft, setJoinDraft] = useState<JoinDraft>();

  const routeUrl = useMemo(() => new URL(route, window.location.origin), [route]);
  const pathname = routeUrl.pathname;
  const requestedRoomId = getRoomIdFromPath(pathname) ?? routeUrl.searchParams.get("room");

  useEffect(() => {
    const syncRoute = () => setRoute(currentRoute());
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  useEffect(() => {
    if (isDashboardAlias(pathname)) {
      navigateTo("/dashboard", setRoute, true);
    }
  }, [pathname]);

  useEffect(() => {
    if (activeRoom) return;

    let cancelled = false;
    const refresh = async () => {
      setRoomsLoading(true);
      try {
        const payload = await getRooms();
        if (!cancelled) {
          setRooms(payload.rooms);
          setRoomsError("");
        }
      } catch (error) {
        if (!cancelled) setRoomsError(error instanceof Error ? error.message : "Unable to load rooms.");
      } finally {
        if (!cancelled) setRoomsLoading(false);
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeRoom]);

  useEffect(() => {
    if (!requestedRoomId) {
      if (activeRoom) setActiveRoom(undefined);
      return;
    }

    const requestedRoom = rooms.find((room) => room.roomId === requestedRoomId);
    if (!requestedRoom || activeRoom?.roomId === requestedRoom.roomId || joinDraft?.room.roomId === requestedRoom.roomId) {
      return;
    }

    if (displayName) {
      setActiveRoom(requestedRoom);
    } else {
      setJoinDraft({ room: requestedRoom, name: "" });
    }
  }, [activeRoom, displayName, joinDraft, requestedRoomId, rooms]);

  const enterRoom = (room: RoomSummary) => {
    setJoinDraft({ room, name: displayName });
  };

  const confirmJoin = (name: string) => {
    const cleanName = name.trim().replace(/\s+/g, " ").slice(0, 32);
    if (!joinDraft || cleanName.length < 2) return;

    setDisplayName(cleanName);
    setActiveRoom(joinDraft.room);
    setJoinDraft(undefined);
    navigateTo(roomPath(joinDraft.room.roomId), setRoute);
  };

  if (activeRoom) {
    return (
      <MultiplayerRoom
        room={activeRoom}
        displayName={displayName}
        onLeave={() => {
          setActiveRoom(undefined);
          navigateTo("/dashboard", setRoute);
        }}
      />
    );
  }

  return (
    <>
      <Lobby
        rooms={rooms}
        loading={roomsLoading}
        error={roomsError}
        onRefresh={async () => {
          const payload = await getRooms();
          setRooms(payload.rooms);
        }}
        onCreate={async (input) => {
          const payload = await createStoredRoom(input);
          setRooms((current) => [payload.room, ...current]);
          enterRoom(payload.room);
        }}
        onJoin={enterRoom}
      />
      {joinDraft ? (
        <NameDialog
          room={joinDraft.room}
          initialName={joinDraft.name}
          onCancel={() => {
            setJoinDraft(undefined);
            if (requestedRoomId) navigateTo("/dashboard", setRoute);
          }}
          onSubmit={confirmJoin}
        />
      ) : null}
    </>
  );
}
