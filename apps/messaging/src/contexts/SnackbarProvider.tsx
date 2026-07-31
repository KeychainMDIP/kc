import { createContext, ReactNode, useContext, useMemo } from "react";
import { toaster } from "../modals/Toaster";

interface SnackbarContextValue {
    setError: (error: any) => void;
    setWarning: (warning: string) => void;
    setSuccess: (message: string) => void;
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

function extractMessage(error: any): string {
    return (
        error?.error ||
        error?.message ||
        (typeof error === "string" ? error : JSON.stringify(error))
    );
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
    const defaultDuration = 5000;

    const value = useMemo<SnackbarContextValue>(
        () => ({
            setSuccess: (message: string) => {
                toaster.create({
                    type: "success",
                    title: message,
                    duration: defaultDuration,
                });
            },
            setWarning: (warning: string) => {
                toaster.create({
                    type: "warning",
                    title: warning,
                    duration: defaultDuration,
                });
            },
            setError: (error: any) => {
                toaster.create({
                    type: "error",
                    title: extractMessage(error),
                    duration: defaultDuration,
                });
            },
        }),
        []
    );

    return (
        <SnackbarContext.Provider value={value}>
            {children}
        </SnackbarContext.Provider>
    );
}

export function useSnackbar() {
    const ctx = useContext(SnackbarContext);
    if (!ctx) {
        throw new Error("useSnackbar must be used within SnackbarProvider");
    }
    return ctx;
}
