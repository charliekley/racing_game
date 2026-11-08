/** Minimal typed event emitter: `sig.add(fn)` subscribes (returns an unsubscribe function), `sig.emit(v)` notifies. */
export class Signal<T> {
  private listeners = new Set<(value: T) => void>();

  add(fn: (value: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(value: T): void {
    for (const fn of [...this.listeners]) fn(value);
  }

  clear(): void {
    this.listeners.clear();
  }
}
