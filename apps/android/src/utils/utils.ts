
export function extractDid(input: string): string | null {
    if (!input) {
        return null;
    }

    const didRegex = /did:[a-z0-9]+:[^\s&#?]+/i;

    const direct = input.match(didRegex);
    if (direct) {
        return direct[0];
    }

    try {
        const url = new URL(input);

        const q = url.searchParams.get("challenge");
        if (q && q.startsWith("did:")) {
            return q;
        }
    } catch {}

    return null;
}
