import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type SafeAreaInsets = {
    top: number;
    bottom: number;
    left: number;
    right: number;
};

const SafeAreaContext = createContext<SafeAreaInsets | null>(null);

function measureEnvInset(side: 'top' | 'bottom' | 'left' | 'right'): number {
    try {
        const el = document.createElement('div');
        const cssProp = side === 'top'
            ? 'padding-top'
            : side === 'bottom'
                ? 'padding-bottom'
                : side === 'left'
                    ? 'padding-left'
                    : 'padding-right';
        el.setAttribute('style', `position:fixed; visibility:hidden; pointer-events:none; ${cssProp}: env(safe-area-inset-${side}); ${cssProp}: constant(safe-area-inset-${side});`);
        document.body.appendChild(el);
        const styles = window.getComputedStyle(el);
        const val = parseFloat(styles.getPropertyValue(cssProp)) || 0;
        document.body.removeChild(el);
        return Math.max(0, Math.round(val));
    } catch {
        return 0;
    }
}

function computeVisualViewportInsets(): SafeAreaInsets {
    const view = window.visualViewport;
    if (!view) {
        return {top: 0, bottom: 0, left: 0, right: 0};
    }
    const top = Math.max(0, Math.round(view.offsetTop));
    const left = Math.max(0, Math.round(view.offsetLeft));
    const bottom = Math.max(0, Math.round((window.innerHeight - view.height - view.offsetTop)));
    const right = Math.max(0, Math.round((window.innerWidth - view.width - view.offsetLeft)));
    return { top, bottom, left, right };
}

function getInsets(): SafeAreaInsets {
    const envTop = measureEnvInset('top');
    const envBottom = measureEnvInset('bottom');
    const envLeft = measureEnvInset('left');
    const envRight = measureEnvInset('right');
    const view = computeVisualViewportInsets();
    return {
        top: Math.max(envTop, view.top),
        bottom: Math.max(envBottom, view.bottom),
        left: Math.max(envLeft, view.left),
        right: Math.max(envRight, view.right),
    };
}

export function SafeAreaProvider({ children }: { children: ReactNode }) {
    const [insets, setInsets] = useState<SafeAreaInsets>({ top: 0, bottom: 0, left: 0, right: 0 });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return;
        }

        const update = () => setInsets(getInsets());

        update();

        const view = window.visualViewport;
        view?.addEventListener('resize', update);
        view?.addEventListener('scroll', update);
        window.addEventListener('resize', update);
        window.addEventListener('orientationchange', update);

        return () => {
            view?.removeEventListener('resize', update);
            view?.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
            window.removeEventListener('orientationchange', update);
        };
    }, []);

    return <SafeAreaContext.Provider value={insets}>{children}</SafeAreaContext.Provider>;
}

export function useSafeArea(): SafeAreaInsets {
    const ctx = useContext(SafeAreaContext);
    if (!ctx) {
        return {top: 0, bottom: 0, left: 0, right: 0};
    }
    return ctx;
}
