type Listener = (url: string) => void;
const listeners = new Map<string, Set<Listener>>();
const localRouter = {
  events: {
    on(event: string, listener: Listener) {
      const callbacks = listeners.get(event) ?? new Set<Listener>();
      callbacks.add(listener);
      listeners.set(event, callbacks);
    },
    off(event: string, listener: Listener) { listeners.get(event)?.delete(listener); },
  },
};
export default localRouter;
