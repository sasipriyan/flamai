export function currentRoute(): string {
  return `${window.location.pathname}${window.location.search}`;
}

export function navigateTo(path: string, setRoute: (route: string) => void, replace = false): void {
  if (currentRoute() === path) return;

  if (replace) {
    window.history.replaceState(null, "", path);
  } else {
    window.history.pushState(null, "", path);
  }
  setRoute(currentRoute());
}

export function getRoomIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/room\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export function roomPath(roomId: string): string {
  return `/room/${encodeURIComponent(roomId)}`;
}

export function isDashboardAlias(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/register";
}
