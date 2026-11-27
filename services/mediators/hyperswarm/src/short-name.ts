export function shortName(value: string): string {
    return value.slice(0, 4) + '-' + value.slice(-4);
}
