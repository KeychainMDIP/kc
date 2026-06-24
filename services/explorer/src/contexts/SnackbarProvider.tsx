import React, { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Alert, AlertColor, Snackbar } from "@mui/material";

interface SnackbarContextValue {
    setError: (error: unknown) => void;
    showMessage: (message: string, severity?: AlertColor) => void;
    closeSnackbar: () => void;
}

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

function getErrorMessage(error: unknown): string {
    if (typeof error === "string") {
        return error;
    }

    if (error instanceof Error) {
        return error.message;
    }

    if (error && typeof error === "object") {
        const record = error as { error?: unknown; message?: unknown };

        if (typeof record.error === "string") {
            return record.error;
        }

        if (typeof record.message === "string") {
            return record.message;
        }

        try {
            const json = JSON.stringify(error);
            if (json) {
                return json;
            }
        }
        catch {
            return String(error);
        }
    }

    return String(error);
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    const closeSnackbar = useCallback(() => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    }, []);

    const showMessage = useCallback((message: string, severity: AlertColor = "info") => {
        setSnackbar({
            open: true,
            message,
            severity,
        });
    }, []);

    const setError = useCallback((error: unknown) => {
        showMessage(getErrorMessage(error), "error");
    }, [showMessage]);

    const value = useMemo<SnackbarContextValue>(() => ({
        setError,
        showMessage,
        closeSnackbar,
    }), [closeSnackbar, setError, showMessage]);

    return (
        <SnackbarContext.Provider value={value}>
            <Snackbar
                open={snackbar.open}
                autoHideDuration={5000}
                onClose={closeSnackbar}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            >
                <Alert
                    onClose={closeSnackbar}
                    severity={snackbar.severity}
                    sx={{ width: "100%" }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>
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
