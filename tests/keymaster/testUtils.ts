
if (typeof globalThis.atob === 'undefined') {
    (globalThis as any).atob = (b64: string) => Buffer.from(b64, 'base64').toString('binary');
}

if (typeof globalThis.btoa === 'undefined') {
    (globalThis as any).btoa = (bin: string) => Buffer.from(bin, 'binary').toString('base64');
}

type CryptoLike = typeof globalThis.crypto | undefined;

export function disableSubtle(): () => void {
    const originalDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const originalCrypto: CryptoLike = (originalDesc?.value ?? (globalThis as any).crypto) as any;

    const mockCrypto: any = originalCrypto ? { ...originalCrypto } : undefined;
    if (mockCrypto && 'subtle' in mockCrypto) {
        delete mockCrypto.subtle;
    }

    try {
        Object.defineProperty(globalThis, 'crypto', { value: mockCrypto, configurable: true });
        return () => {
            if (originalDesc) {
                Object.defineProperty(globalThis, 'crypto', originalDesc);
            } else {
                delete (globalThis as any).crypto;
            }
        };
    } catch {
        const target = (globalThis as any).crypto;
        const desc = Object.getOwnPropertyDescriptor(target, 'subtle');
        if (desc?.configurable) {
            Object.defineProperty(target, 'subtle', { value: undefined, configurable: true });
            return () => {
                Object.defineProperty(target, 'subtle', desc);
            };
        }
        const old = target?.subtle;
        (globalThis as any).crypto && ((globalThis as any).crypto.subtle = undefined);
        return () => {
            if ((globalThis as any).crypto) {
                (globalThis as any).crypto.subtle = old;
            }
        };
    }
}

export async function restoreNodeWebcrypto(): Promise<() => void> {
    const nodeWebcrypto = (await import('node:crypto')).webcrypto as Crypto;

    const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
        value: nodeWebcrypto,
        configurable: true,
    });

    return () => {
        if (origDesc) {
            Object.defineProperty(globalThis, 'crypto', origDesc);
        } else {
            delete (globalThis as any).crypto;
        }
    };
}
