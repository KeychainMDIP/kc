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
    Typography,
} from "@mui/material";
import Header from "./components/Header.js";
import { GatekeeperEvent } from "@mdip/gatekeeper/types";
import { Routes, Route, useNavigate, Navigate } from 'react-router-dom';

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
    const [events, setEvents] = useState<GatekeeperEvent[]>([]);
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


    useEffect(() => {
        if (!isReady) {
            return;
        }

        let isMounted = true;
        let intervalId: NodeJS.Timeout | undefined;

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

                const dids = (await gatekeeper.getDIDs({
                    updatedAfter,
                    updatedBefore
                })) as string[];
                let allEvents = (await gatekeeper.exportDIDs(dids)).flat();

                if (registry !== "All") {
                    allEvents = allEvents.filter((evt) => evt.registry === registry);
                }

                allEvents.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

                const from = page * eventCount;
                const to = from + eventCount;
                const pageEvents = allEvents.slice(from, to);
                const totalCount = allEvents.length;

                if (isMounted) {
                    setEvents(pageEvents);
                    setTotal(totalCount);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReady, eventCount, page, registry, dateFrom, dateTo]);

    const totalPages = Math.ceil(total / eventCount);

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
                            />
                            <Routes>
                                <Route
                                    path="/"
                                    element={<Navigate to="/search" replace />}
                                />
                                <Route
                                    path="/search"
                                    element={
                                        <JsonViewer
                                            gatekeeper={gatekeeper}
                                            setError={setError}
                                        />
                                    }
                                />
                                <Route
                                    path="/events"
                                    element={
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
                                    }
                                />
                                <Route
                                    path="*"
                                    element={<Typography>404 Not Found</Typography>}
                                />
                            </Routes>
                        </Box>
                    }
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default App;
