// A message channel between a feature's isolated-world content script and its
// MAIN-world script. Both worlds share the DOM, so they talk through custom
// events on `document`. Payloads are JSON strings: event detail objects do not
// cross worlds. Page scripts can dispatch these events too, so receivers must
// validate what they get.

export interface Channel<Out, In> {
  send(message: Out): void;
  /** Returns a function that removes the handler. */
  onMessage(handler: (message: In) => void): () => void;
}

export function createChannel<Out, In>(name: string, side: "isolated" | "main", target: EventTarget = document): Channel<Out, In> {
  const toMain = `sakti:${name}:to-main`;
  const toIsolated = `sakti:${name}:to-isolated`;
  const outgoing = side === "isolated" ? toMain : toIsolated;
  const incoming = side === "isolated" ? toIsolated : toMain;

  return {
    send(message) {
      target.dispatchEvent(new CustomEvent(outgoing, { detail: JSON.stringify(message) }));
    },
    onMessage(handler) {
      const listener = (event: Event) => {
        const detail: unknown = (event as CustomEvent).detail;
        if (typeof detail !== "string") return;
        let message: In;
        try {
          message = JSON.parse(detail) as In;
        } catch {
          return;
        }
        handler(message);
      };
      target.addEventListener(incoming, listener);
      return () => target.removeEventListener(incoming, listener);
    },
  };
}
