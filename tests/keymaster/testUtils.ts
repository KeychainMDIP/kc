type CryptoLike = typeof globalThis.crypto | undefined;

export function disableSubtle(): () => void {
    const originalDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    const originalCrypto: CryptoLike = originalDesc?.value;

    const mockCrypto: any = { ...originalCrypto };

    Object.defineProperty(globalThis, 'crypto', { value: mockCrypto, configurable: true });
    return () => {
        Object.defineProperty(globalThis, 'crypto', originalDesc!);
    };
}

export async function restoreNodeWebcrypto(): Promise<() => void> {
    const nodeWebcrypto = (await import('node:crypto')).webcrypto as Crypto;

    const origDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
        value: nodeWebcrypto,
        configurable: true,
    });

    return () => {
        Object.defineProperty(globalThis, 'crypto', origDesc!);
    };
}
