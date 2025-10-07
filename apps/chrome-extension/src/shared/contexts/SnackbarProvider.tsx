import React, { createContext, ReactNode, useContext, useState } from "react";
import { Alert, AlertColor, Snackbar } from "@mui/material";

interface SnackbarContextValue {
    setError: (error: any) => void;
    setWarning: (warning: string) => void;
    setSuccess: (message: string) => void;
}

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null);

export function SnackbarProvider({ children }: { children: ReactNode }) {
    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    const handleSnackbarClose = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    const setError = (error: any) => {
        const errorMessage = error?.error || error?.message || (typeof error === "string" ? error : JSON.stringify(error));
        setSnackbar({ open: true, message: errorMessage, severity: "error" });
    };

    const setWarning = (warning: string) => {
        setSnackbar({ open: true, message: warning, severity: "warning" });
    };

    const setSuccess = (message: string) => {
        setSnackbar({ open: true, message, severity: "success" });
    };

    const value: SnackbarContextValue = {
        setError,
        setWarning,
        setSuccess
    };

    return (
        <SnackbarContext.Provider value={value}>
            <Snackbar
                open={snackbar.open}
                autoHideDuration={5000}
                onClose={handleSnackbarClose}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            >
                <Alert onClose={handleSnackbarClose} severity={snackbar.severity} sx={{ width: "100%" }}>
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
