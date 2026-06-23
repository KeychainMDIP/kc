import React, { useEffect, useState } from "react";
import JsonViewer from "./components/JsonViewer.js";
import Events from "./components/Events.js";
import Credentials from "./components/Credentials.js";
import ChallengeReceipts from "./components/ChallengeReceipts.js";
import {
    Box,
    Typography,
} from "@mui/material";
import Header from "./components/Header.js";
import { Routes, Route, useNavigate, Navigate } from "react-router-dom";
import type { GatekeeperEvent } from "@mdip/gatekeeper/types";
import { useSnackbar } from "./contexts/SnackbarProvider.js";
import { useExplorerContext } from "./contexts/ExplorerProvider.js";

function App() {
    const { setError } = useSnackbar();
    const {
        config,
        searchClient,
        isReady,
        readinessMessage,
    } = useExplorerContext();
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

                const result = await searchClient.fetchSearchServerEvents({
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
                    time: time || event.time,
                }));

                if (isMounted) {
                    setEvents(pageEvents);
                    setTotal(result.total);
                }
            } catch (err: unknown) {
                if (isMounted) {
                    setError(err);
                }
            }
        }

        fetchRecent();

        intervalId = setInterval(fetchRecent, config.eventsPollIntervalMs);

        return () => {
            isMounted = false;
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [config.eventsPollIntervalMs, isReady, eventCount, page, registry, dateFrom, dateTo, searchClient, setError]);

    const totalPages = Math.ceil(total / eventCount);
    const waiting = <Typography sx={{ mt: 3 }}>{readinessMessage}</Typography>;

    return (
        <Box sx={{
            bgcolor: "background.default",
            color: "text.primary",
            minHeight: "100vh",
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-start"
        }}>
            <Box sx={{ width: "900px", boxSizing: "border-box", p: 2 }}>
                <Box>
                    <Header />
                    <Routes>
                        <Route
                            path="/"
                            element={<Navigate to="/search" replace />}
                        />
                        <Route
                            path="/search"
                            element={isReady ? (
                                <JsonViewer />
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
                                />
                            ) : (
                                waiting
                            )}
                        />
                        <Route
                            path="/credentials"
                            element={isReady ? (
                                <Credentials />
                            ) : (
                                waiting
                            )}
                        />
                        <Route
                            path="/receipts"
                            element={isReady ? (
                                <ChallengeReceipts />
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
    );
}

export default App;
