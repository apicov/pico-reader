/** Something that changes, and what follows it: `subscribe` returns what unsubscribes, `emit` tells every listener
 *  (with what changed, for signals that carry a value). */
export function createSignal<T = void>() {
  const listeners = new Set<(value: T) => void>();
  return {
    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    emit(value: T): void {
      listeners.forEach((l) => l(value));
    },
  };
}
