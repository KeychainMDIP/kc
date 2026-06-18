import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { CssBaseline } from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { SnackbarProvider } from "./SnackbarProvider.js";
import { ExplorerProvider } from "./ExplorerProvider.js";

interface ThemeContextValue {
    darkMode: boolean;
    handleThemeToggle: (event: React.ChangeEvent<HTMLInputElement>) => void;
    updateThemeFromStorage: () => void;
    themeStorageKey: string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);
const themeStorageKey = "mdip-explorer-theme-mode";

export function ContextProviders({ children }: { children: ReactNode }) {
    const [darkMode, setDarkMode] = useState<boolean>(false);

    const theme = useMemo(() => createTheme({
        palette: {
            mode: darkMode ? "dark" : "light",
        },
    }), [darkMode]);

    function handleThemeToggle(event: React.ChangeEvent<HTMLInputElement>) {
        const isDark = event.target.checked;
        setDarkMode(isDark);
        localStorage.setItem(themeStorageKey, isDark ? "dark" : "light");
    }

    function updateThemeFromStorage() {
        const themeMode = localStorage.getItem(themeStorageKey);
        if (themeMode) {
            setDarkMode(themeMode === "dark");
        }
    }

    const value = useMemo<ThemeContextValue>(() => ({
        darkMode,
        handleThemeToggle,
        updateThemeFromStorage,
        themeStorageKey,
    }), [darkMode]);

    useEffect(() => {
        updateThemeFromStorage();
    }, []);

    return (
        <ThemeContext.Provider value={value}>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <SnackbarProvider>
                    <ExplorerProvider>
                        {children}
                    </ExplorerProvider>
                </SnackbarProvider>
            </ThemeProvider>
        </ThemeContext.Provider>
    );
}

export function useThemeContext() {
    const ctx = useContext(ThemeContext);

    if (!ctx) {
        throw new Error("useThemeContext must be used within ContextProviders");
    }

    return ctx;
}
