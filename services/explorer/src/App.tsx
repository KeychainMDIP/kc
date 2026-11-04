import React, { useEffect, useState } from "react";
import JsonViewer from "./components/JsonViewer.js";
import Events from "./components/Events.js";
import Network from "./components/Network.js";
import Credentials from "./components/Credentials.js";
import ChallengeReceipts from "./components/ChallengeReceipts.js";
import {
    Box,
    Typography,
} from "@mui/material";
import Header from "./components/Header.js";
import { Routes, Route, useMatch, useNavigate, Navigate } from "react-router-dom";
import type { GatekeeperEvent } from "@mdip/gatekeeper/types";
import { useSnackbar } from "./contexts/SnackbarProvider.js";
import { useExplorerContext } from "./contexts/ExplorerProvider.js";
import { startPolling } from "./lifecycle.js";

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
    const isEventsRoute = Boolean(useMatch("/events"));

    function handleViewDid(did: string) {
        navigate(`/search?did=${encodeURIComponent(did)}`);
    }

    useEffect(() => {
        if (!isReady || !isEventsRoute) {
            return;
        }

        return startPolling({
            intervalMs: config.eventsPollIntervalMs,
            async run(signal) {
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
                }, signal);
                const pageEvents = result.events.map(({ did, registry, time, event }) => ({
                    ...event,
                    did: event.did ?? did,
                    registry: event.registry ?? registry,
                    time: time || event.time,
                }));

                return { pageEvents, total: result.total };
            },
            onResult(result) {
                setEvents(result.pageEvents);
                setTotal(result.total);
                return true;
            },
            onError(error) {
                setError(error);
                return true;
            },
        });
    }, [
        config.eventsPollIntervalMs,
        isReady,
        eventCount,
        page,
        registry,
        dateFrom,
        dateTo,
        isEventsRoute,
        searchClient,
        setError,
    ]);

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
                            path="/network"
                            element={isReady ? (
                                <Network />
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
