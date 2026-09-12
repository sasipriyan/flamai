import type { ConnectionStatus } from "../connection";

const labels: Record<ConnectionStatus, string> = {
  connecting: "Connecting",
  open: "Connected",
  reconnecting: "Reconnecting",
  closed: "Closed",
};

export function StatusPill({ status }: { status: ConnectionStatus }) {
  return (
    <span className={`status-pill ${status}`} title={`Connection status: ${labels[status]}`}>
      {labels[status]}
    </span>
  );
}
