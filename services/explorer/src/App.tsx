import React, {useEffect, useMemo, useRef, useState} from 'react';
import JsonViewer from "./components/JsonViewer.js";
import Queue from "./components/Queue.js";
import Recent from "./components/Recent.js";
import GatekeeperClient from '@mdip/gatekeeper/client';
import { createTheme, ThemeProvider } from "@mui/material/styles";
import {
    Alert,
    AlertColor,
    Box,
    CssBaseline,
    Snackbar,
    Tab,
    Tabs,
} from "@mui/material";
import Header from "./components/Header.js";
import { Index } from 'flexsearch';

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
    const [operationsSubTab, setOperationsSubTab] = useState<string>("recent");
    const [viewDid, setViewDid] = useState<string>("");
    const flexIndexRef = useRef<Index | null>(null);

    useEffect(() => {
        flexIndexRef.current = new Index({
            tokenize: "forward",
            cache: true,
        });

        refreshIndex();

        const interval = setInterval(() => {
            refreshIndex();
        }, 60_000);

        return () => {
            clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function refreshIndex() {
        if (!flexIndexRef.current || !isReady) {
            return;
        }

        try {
            const dids = await gatekeeper.getDIDs() as string[];
            for (const did of dids) {
                const doc = await gatekeeper.resolveDID(did);
                const docString = JSON.stringify(doc);
                flexIndexRef.current.add(did, docString);
            }
        } catch (err) {}
    }

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

    useEffect(() => {
        const storedSubTab = sessionStorage.getItem("mdip-explorer-operations-sub-tab");
        if (storedSubTab) {
            setOperationsSubTab(storedSubTab);
        }
    }, []);

    useEffect(() => {
        sessionStorage.setItem("mdip-explorer-operations-sub-tab", operationsSubTab);
    }, [operationsSubTab]);

    const handleSnackbarClose = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    useEffect(() => {
        let interval: NodeJS.Timeout;

        async function init() {
            await gatekeeper.connect({
                url: gatekeeperUrl,
                waitUntilReady: true,
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
                                    flexIndex={flexIndexRef.current}
                                />
                            )}
                            {tabValue === "operations" && (
                                <Box>
                                    <Tabs
                                        value={operationsSubTab}
                                        onChange={(event, newValue) => setOperationsSubTab(newValue)}
                                        sx={{ mb: 2 }}
                                    >
                                        <Tab label="Recent" value="recent" />
                                        <Tab label="Queued" value="queued" />
                                    </Tabs>
                                    {operationsSubTab === "recent" && (
                                        <Recent
                                            gatekeeper={gatekeeper}
                                            setError={setError}
                                            onDidClick={handleViewDid}
                                        />
                                    )}
                                    {operationsSubTab === "queued" && (
                                        <Queue
                                            gatekeeper={gatekeeper}
                                            setError={setError}
                                            onDidClick={handleViewDid}
                                        />
                                    )}
                                </Box>
                            )}
                        </Box>
                    }
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
