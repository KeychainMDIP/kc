import React, { createContext, Dispatch, ReactNode, SetStateAction, useContext, useEffect, useState } from "react";
import { WalletProvider } from "./WalletProvider";
import { CredentialsProvider } from "./CredentialsProvider";
import { AuthProvider } from "./AuthContext";
import { MessageProvider } from "./MessageContext";
import { RefreshMode, UIProvider, openBrowserValues } from "./UIContext";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { Box } from "@mui/material";
import { requestBrowserRefresh } from "../sharedScripts";
import { SnackbarProvider } from "./SnackbarProvider";

interface ThemeContextValue {
    darkMode: boolean;
    handleDarkModeToggle: (event: React.ChangeEvent<HTMLInputElement>) => void;
    updateThemeFromStorage: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ContextProviders(
    {
        children,
        isBrowser,
        pendingAuth,
        pendingCredential,
        openBrowser,
        setOpenBrowser,
        browserRefresh,
        setBrowserRefresh,
    }: {
        children: ReactNode,
        isBrowser: boolean,
        pendingAuth?: string,
        pendingCredential?: string,
        openBrowser?: openBrowserValues,
        setOpenBrowser?: Dispatch<SetStateAction<openBrowserValues | undefined>>,
        browserRefresh?: RefreshMode,
        setBrowserRefresh?: Dispatch<SetStateAction<RefreshMode>>,
    }) {
    const [darkMode, setDarkMode] = useState<boolean>(false);

    const theme = createTheme({
        palette: {
            mode: darkMode ? 'dark' : 'light',
        },
    });

    function handleDarkModeToggle(event: React.ChangeEvent<HTMLInputElement>) {
        const isDark = event.target.checked;
        setDarkMode(isDark);
        chrome.storage.local.set({ themeMode: isDark ? 'dark' : 'light' });
        requestBrowserRefresh(isBrowser, true);
    }

    const value: ThemeContextValue = {
        handleDarkModeToggle,
        darkMode,
        updateThemeFromStorage,
    }

    function updateThemeFromStorage() {
        chrome.storage.local.get(['themeMode'], (result) => {
            if (result.themeMode) {
                setDarkMode(result.themeMode === 'dark');
            }
        });
    }

    useEffect(() => {
        updateThemeFromStorage();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <ThemeContext.Provider value={value}>
            <ThemeProvider theme={theme}>
                <Box
                    sx={{
                        width: isBrowser ? "100%" : 420,
                        height: isBrowser ? "100%" : 500,
                        bgcolor: "background.default",
                        color: "text.primary",
                        p: isBrowser ? 0 : 1,
                    }}
                >
                    <SnackbarProvider>
                        <WalletProvider isBrowser={isBrowser}>
                            <CredentialsProvider>
                                <AuthProvider>
                                    <MessageProvider>
                                        <UIProvider
                                            pendingAuth={pendingAuth}
                                            pendingCredential={pendingCredential}
                                            openBrowser={openBrowser}
                                            browserRefresh={browserRefresh}
                                            setBrowserRefresh={setBrowserRefresh}
                                            setOpenBrowser={setOpenBrowser}
                                        >
                                            {children}
                                        </UIProvider>
                                    </MessageProvider>
                                </AuthProvider>
                            </CredentialsProvider>
                        </WalletProvider>
                    </SnackbarProvider>
                </Box>
            </ThemeProvider>
        </ThemeContext.Provider>
    );
}

export function useThemeContext() {
    const ctx = useContext(ThemeContext);
    if (!ctx) {
        throw new Error('useThemeContext must be used within ContextProviders');
    }
    return ctx;
}
