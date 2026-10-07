export type CloudWatch = { joined: boolean; mine: boolean; live: boolean; who: string; readOnly?: boolean };

let watch: CloudWatch = { joined: false, mine: true, live: false, who: "" };
const listeners = new Set<() => void>();
let pusher: () => void = () => undefined;

export function getCloudWatch(): CloudWatch {
  return watch;
}

export function setCloudWatch(next: CloudWatch, dataChanged = true) {
  if (
    !dataChanged &&
    next.joined === watch.joined &&
    next.mine === watch.mine &&
    next.live === watch.live &&
    next.who === watch.who &&
    next.readOnly === watch.readOnly
  )
    return;
  watch = next;
  for (const listener of listeners) listener();
}

export function setCloudPusher(push: () => void) {
  pusher = push;
}

export function pushCloudChange() {
  if (watch.joined && watch.live) pusher();
}

export function subscribeCloudWatch(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
