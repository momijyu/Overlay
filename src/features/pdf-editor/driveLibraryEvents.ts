const listeners = new Set<() => void>();
export function notifyLibraryChanged() { for (const listener of listeners) listener(); }
export function subscribeLibraryChanged(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
