import React, {useCallback, useEffect, useMemo, useState} from 'react';
import JsonViewer from "./components/JsonViewer.js";
import Events from "./components/Events.js";
import Credentials from "./components/Credentials.js";
import ChallengeReceipts from "./components/ChallengeReceipts.js";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import {
    Alert,
    AlertColor,
    Box,
    CssBaseline,
    Snackbar,
    Typography,
} from "@mui/material";
import Header from "./components/Header.js";
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';
import type { ExplorerDIDEvent } from "./shared/utilities.js";
import {
    fetchSearchServerEvents,
    fetchSearchServerStatus,
    isSearchServerReady,
} from "./shared/utilities.js";

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

function App() {
    const [isReady, setIsReady] = useState<boolean>(false);
    const [readinessMessage, setReadinessMessage] = useState<string>("Waiting for Search Server...");
    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });
    const [darkMode, setDarkMode] = useState<boolean>(false);
    const [events, setEvents] = useState<ExplorerDIDEvent[]>([]);
    const [total, setTotal] = useState<number>(0);
    const [eventCount, setEventCount] = useState<number>(50);
    const [page, setPage] = useState<number>(0);
    const [registry, setRegistry] = useState<string>("All");

    const [dateFrom, setDateFrom] = useState<string>(() => {
        const dayAgo = new Date();
        dayAgo.setDate(dayAgo.getDate() - 1);
        return dayAgo.toISOString().slice(0, 10);
    });
    const [dateTo, setDateTo] = useState<string>(() => {
        return new Date().toISOString().slice(0, 10);
    });

    const navigate = useNavigate();

    function handleViewDid(did: string) {
        navigate(`/search?did=${encodeURIComponent(did)}`);
    }

    const setError = useCallback((error: any) => {
        const errorMessage = error.error || error.message || String(error);
        setSnackbar({
            open: true,
            message: errorMessage,
            severity: "error",
        });
    }, []);

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
        let cancelled = false;
        let interval: ReturnType<typeof setInterval> | undefined;

        async function checkReadiness() {
            try {
                const status = await fetchSearchServerStatus();

                if (cancelled) {
                    return;
                }

                if (isSearchServerReady(status)) {
                    setIsReady(true);
                    if (interval) {
                        clearInterval(interval);
                    }
                    return;
                }

                setIsReady(false);
                setReadinessMessage(
                    status.sync?.lastSyncError
                        ? "Search Server sync error. Retrying..."
                        : "Waiting for Search Server sync..."
                );
            }
            catch {
                if (!cancelled) {
                    setIsReady(false);
                    setReadinessMessage("Waiting for Search Server...");
                }
            }
        }

        checkReadiness();
        interval = setInterval(checkReadiness, 5000);

        return () => {
            cancelled = true;
            if (interval) {
                clearInterval(interval);
            }
        };
    }, []);


    useEffect(() => {
        if (!isReady) {
            return;
        }

        let isMounted = true;
        let intervalId: ReturnType<typeof setInterval> | undefined;

        async function fetchRecent() {
            try {
                let updatedAfter: string | undefined;
                let updatedBefore: string | undefined;

                if (dateFrom) {
                    const fromDate = new Date(`${dateFrom}T00:00:00`);
                    updatedAfter = fromDate.toISOString();
                }

                if (dateTo) {
                    const toDate = new Date(`${dateTo}T23:59:59.999`);
                    updatedBefore = toDate.toISOString();
                }

                const result = await fetchSearchServerEvents({
                    registry: registry === "All" ? undefined : registry,
                    updatedAfter,
                    updatedBefore,
                    limit: eventCount,
                    offset: page * eventCount,
                });
                const pageEvents = result.events.map(({ did, registry, time, event }) => ({
                    ...event,
                    did: event.did ?? did,
                    registry: event.registry ?? registry,
                    time: event.time ?? time,
                }));

                if (isMounted) {
                    setEvents(pageEvents);
                    setTotal(result.total);
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err);
                }
            }
        }

        fetchRecent();

        intervalId = setInterval(fetchRecent, 10000);

        return () => {
            isMounted = false;
            if (intervalId) clearInterval(intervalId);
        };
    }, [isReady, eventCount, page, registry, dateFrom, dateTo, setError]);

    const totalPages = Math.ceil(total / eventCount);
    const waiting = <Typography sx={{ mt: 3 }}>{readinessMessage}</Typography>;

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

                    <Box>
                        <Header
                            handleThemeToggle={handleThemeToggle}
                            darkMode={darkMode}
                        />
                        <Routes>
                            <Route
                                path="/"
                                element={<Navigate to="/search" replace />}
                            />
                            <Route
                                path="/search"
                                element={isReady ? (
                                    <JsonViewer
                                        setError={setError}
                                    />
                                ) : (
                                    waiting
                                )}
                            />
                            <Route
                                path="/events"
                                element={isReady ? (
                                    <Events
                                        events={events}
                                        eventCount={eventCount}
                                        page={page}
                                        dateFrom={dateFrom}
                                        dateTo={dateTo}
                                        registry={registry}
                                        totalPages={totalPages}
                                        setEventCount={setEventCount}
                                        setPage={setPage}
                                        setRegistry={setRegistry}
                                        setDateFrom={setDateFrom}
                                        setDateTo={setDateTo}
                                        onDidClick={handleViewDid}
                                        setError={setError}
                                    />
                                ) : (
                                    waiting
                                )}
                            />
                            <Route
                                path="/credentials"
                                element={isReady ? (
                                    <Credentials
                                        setError={setError}
                                    />
                                ) : (
                                    waiting
                                )}
                            />
                            <Route
                                path="/receipts"
                                element={isReady ? (
                                    <ChallengeReceipts
                                        setError={setError}
                                    />
                                ) : (
                                    waiting
                                )}
                            />
                            <Route
                                path="*"
                                element={<Typography>404 Not Found</Typography>}
                            />
                        </Routes>
                    </Box>
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
