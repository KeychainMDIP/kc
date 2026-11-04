package org.keychain.gatekeeper;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class GatekeeperClientCancellation {
    private boolean cancelled;
    private final Set<Runnable> listeners = new HashSet<>();

    public void cancel() {
        List<Runnable> callbacks;
        synchronized (this) {
            if (cancelled) {
                return;
            }
            cancelled = true;
            callbacks = new ArrayList<>(listeners);
            listeners.clear();
        }
        callbacks.forEach(Runnable::run);
    }

    Runnable onCancel(Runnable listener) {
        synchronized (this) {
            if (!cancelled) {
                listeners.add(listener);
                return () -> {
                    synchronized (this) {
                        listeners.remove(listener);
                    }
                };
            }
        }
        listener.run();
        return () -> {};
    }
}
