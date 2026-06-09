type GoodbyeCallback = () => void | Promise<void>;

const callbacks: GoodbyeCallback[] = [];

export function __runGoodbyeCallbacks(): Promise<void[]> {
    return Promise.all(callbacks.map(callback => Promise.resolve(callback())));
}

export default function goodbye(callback: GoodbyeCallback): void {
    callbacks.push(callback);
}
