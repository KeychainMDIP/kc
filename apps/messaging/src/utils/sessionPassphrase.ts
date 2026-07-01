let sessionPassphrase: string | null = null;

export function getSessionPassphrase(): string {
    return sessionPassphrase ?? "";
}

export function setSessionPassphrase(passphrase: string) {
    sessionPassphrase = passphrase;
}

export function clearSessionPassphrase() {
    sessionPassphrase = "";
}
