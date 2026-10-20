export interface OperationPageReservation {
    readonly bytes: number;
    release(): void;
}

export interface OperationPageBudget {
    readonly pages: number;
    readonly bytes: number;
    reserve(bytes: number): OperationPageReservation | null;
    getMetrics(): { pages: number; bytes: number; admissionFailures: number };
    shutdown(): void;
}

export function createOperationPageBudget(
    maxPages: number,
    maxBytes: number,
): OperationPageBudget {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
        throw new Error('maxPages must be a positive safe integer');
    }
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        throw new Error('maxBytes must be a positive safe integer');
    }

    let pages = 0;
    let bytes = 0;
    let accepting = true;
    let admissionFailures = 0;

    return {
        get pages(): number {
            return pages;
        },
        get bytes(): number {
            return bytes;
        },
        reserve(requestedBytes: number): OperationPageReservation | null {
            if (!Number.isSafeInteger(requestedBytes) || requestedBytes < 0) {
                throw new Error('operation page bytes must be a non-negative safe integer');
            }
            if (!accepting || pages >= maxPages || bytes + requestedBytes > maxBytes) {
                admissionFailures += 1;
                return null;
            }

            pages += 1;
            bytes += requestedBytes;
            let released = false;
            return {
                bytes: requestedBytes,
                release(): void {
                    if (released) {
                        return;
                    }
                    released = true;
                    pages -= 1;
                    bytes -= requestedBytes;
                },
            };
        },
        getMetrics() {
            return { pages, bytes, admissionFailures };
        },
        shutdown(): void {
            accepting = false;
        },
    };
}
