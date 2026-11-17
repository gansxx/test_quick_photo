const MAX_LOG_ENTRIES = 80

type Listener = (entries: string[]) => void

class DebugLoggerStore {
  private entries: string[] = []
  private listeners = new Set<Listener>()

  log(message: string) {
    const now = new Date()
    const time = now.toTimeString().slice(0, 8)
    this.entries = [...this.entries, `${time}  ${message}`].slice(-MAX_LOG_ENTRIES)
    this.notify()
  }

  clear() {
    this.entries = []
    this.notify()
  }

  getEntries(): string[] {
    return this.entries
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.entries)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.entries)
    }
  }
}

export const DebugLogger = new DebugLoggerStore()
