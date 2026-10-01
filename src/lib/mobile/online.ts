let online = typeof navigator === "undefined" ? true : navigator.onLine;
const listeners = new Set<() => void>();

function setOnline(next: boolean) {
  if (online === next) return;
  online = next;
  for (const listener of listeners) listener();
}

export function getOnline(): boolean {
  return online;
}

export function subscribeOnline(listener: () => void): () => void {
  listeners.add(listener);
  const on = () => setOnline(true);
  const off = () => setOnline(false);
  if (typeof window !== "undefined") {
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
  }
  let removeNetwork = () => {};
  if (import.meta.env.VITE_MOBILE === "true") {
    void import("@capacitor/network").then(async ({ Network }) => {
      setOnline((await Network.getStatus()).connected);
      const handle = await Network.addListener("networkStatusChange", (status) => setOnline(status.connected));
      removeNetwork = () => void handle.remove();
    });
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    }
    removeNetwork();
  };
}
