let pendingUrl: string | null = null;

export function queueDeepLink(url: string) {
    pendingUrl = url;
}

export function takeDeepLink(): string | null {
    const url = pendingUrl;
    pendingUrl = null;
    return url;
}
