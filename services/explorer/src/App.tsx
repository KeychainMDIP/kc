import React, {useEffect, useMemo, useState} from 'react';
import JsonViewer from "./components/JsonViewer.js";
import Events from "./components/Events.js";
import GatekeeperClient from '@mdip/gatekeeper/client';
import { createTheme, ThemeProvider } from "@mui/material/styles";
import {
    Alert,
    AlertColor,
    Box,
    CssBaseline,
    Snackbar,
} from "@mui/material";
import Header from "./components/Header.js";

const gatekeeper = new GatekeeperClient();

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

const gatekeeperUrl = import.meta.env.VITE_GATEKEEPER_URL || 'http://localhost:4224';

function App() {
    const [isReady, setIsReady] = useState<boolean>(false);
    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });
    const [darkMode, setDarkMode] = useState<boolean>(false);
    const [tabValue, setTabValue] = useState<string>("search");
    const [viewDid, setViewDid] = useState<string>("");

    function handleViewDid(did: string) {
        setViewDid(did);
        setTabValue("search");
    }

    const setError = (error: any) => {
        const errorMessage = error.error || error.message || String(error);
        setSnackbar({
            open: true,
            message: errorMessage,
            severity: "error",
        });
    };

    const theme = useMemo(() => createTheme({
        palette: {
            mode: darkMode ? 'dark' : 'light',
        },
    }), [darkMode]);

    function handleThemeToggle(event: React.ChangeEvent<HTMLInputElement>) {
        const isDark = event.target.checked;
        setDarkMode(isDark);
        localStorage.setItem('mdip-explorer-theme-mode', isDark ? 'dark' : 'light');
    }

    useEffect(() => {
        const themeMode = localStorage.getItem('mdip-explorer-theme-mode');
        if (themeMode) {
            setDarkMode(themeMode === 'dark');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSnackbarClose = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    useEffect(() => {
        let interval: NodeJS.Timeout;

        async function init() {
            await gatekeeper.connect({
                url: gatekeeperUrl,
                waitUntilReady: true,
                intervalSeconds: 5,
                chatty: true,
            });

            interval = setInterval(async () => {
                if (await gatekeeper.isReady()) {
                    setIsReady(true);
                    clearInterval(interval);
                }
            }, 500);
        }

        init();
    }, []);

    return (
        <ThemeProvider theme={theme}>
            <CssBaseline />
            <Box sx={{
                bgcolor: 'background.default',
                color: 'text.primary',
                minHeight: '100vh',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'flex-start'
            }}>
                <Box sx={{ width: '900px', boxSizing: 'border-box', p: 2 }}>
                    <Snackbar
                        open={snackbar.open}
                        autoHideDuration={5000}
                        onClose={handleSnackbarClose}
                        anchorOrigin={{ vertical: "top", horizontal: "center" }}
                    >
                        <Alert
                            onClose={handleSnackbarClose}
                            severity={snackbar.severity}
                            sx={{ width: "100%" }}
                        >
                            {snackbar.message}
                        </Alert>
                    </Snackbar>

                    {isReady &&
                        <Box>
                            <Header
                                handleThemeToggle={handleThemeToggle}
                                darkMode={darkMode}
                                tabValue={tabValue}
                                setTabValue={setTabValue}
                            />
                            {tabValue === "search" && (
                                <JsonViewer
                                    gatekeeper={gatekeeper}
                                    setError={setError}
                                    viewDid={viewDid}
                                    setViewDid={setViewDid}
                                />
                            )}
                            {tabValue === "recent" && (
                                <Events
                                    gatekeeper={gatekeeper}
                                    setError={setError}
                                    onDidClick={handleViewDid}
                                />
                            )}
                        </Box>
                    }
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
