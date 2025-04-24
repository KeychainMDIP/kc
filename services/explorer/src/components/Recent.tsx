import React, { useEffect, useState } from "react";
import {
    Box,
    Button,
    IconButton,
    Typography,
    Select,
    MenuItem,
    FormControl
} from "@mui/material";
import { GatekeeperEvent, GatekeeperInterface } from "@mdip/gatekeeper/types";
import { getTypeStyle, handleCopyDID } from "../shared/utilities.js";
import ContentCopy from "@mui/icons-material/ContentCopy";

const networksEnv = import.meta.env.VITE_OPERATION_NETWORKS || "hyperswarm";
const knownRegistries: string[] = ["All", ...networksEnv.split(",").map((n: string) => n.trim())];
if (!knownRegistries.includes("local")) {
    knownRegistries.push("local");
}

function Recent(
    {
        gatekeeper,
        setError,
        onDidClick
    }: {
        gatekeeper: GatekeeperInterface;
        setError: (error: any) => void;
        onDidClick: (did: string) => void;
    }) {
    const [events, setEvents] = useState<GatekeeperEvent[]>([]);
    const [total, setTotal] = useState<number>(0);
    const [eventCount, setEventCount] = useState<number>(50);
    const [page, setPage] = useState<number>(0);
    const [registry, setRegistry] = useState<string>("All");

    useEffect(() => {
        let isMounted = true;
        let intervalId: NodeJS.Timeout | undefined;

        async function fetchRecent() {
            try {
                const dids = (await gatekeeper.getDIDs()) as string[];
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
    }, [eventCount, page, registry]);

    const handleCountChange = (e: any) => {
        setEventCount(e.target.value);
        setPage(0);
    };

    const handleRegistryChange = (e: any) => {
        setRegistry(e.target.value);
        setPage(0);
    };

    const totalPages = Math.ceil(total / eventCount);

    return (
        <Box sx={{ ml: 1, mt: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 2 }}>
                <FormControl size="small" sx={{ minWidth: 120 }}>
                    <Select value={eventCount} onChange={handleCountChange}>
                        <MenuItem value={50}>50</MenuItem>
                        <MenuItem value={100}>100</MenuItem>
                        <MenuItem value={200}>200</MenuItem>
                    </Select>
                </FormControl>

                <FormControl size="small" sx={{ minWidth: 120 }}>
                    <Select value={registry} onChange={handleRegistryChange}>
                        {knownRegistries.map((r) => (
                            <MenuItem key={r} value={r}>
                                {r}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <Box display="flex" alignItems="center" gap={1}>
                    <Button
                        variant="outlined"
                        size="small"
                        disabled={page === 0}
                        onClick={() => setPage((p) => p - 1)}
                    >
                        Prev
                    </Button>
                    <Typography>
                        Page {page + 1} / {totalPages === 0 ? 1 : totalPages} (total: {total})
                    </Typography>
                    <Button
                        variant="outlined"
                        size="small"
                        disabled={page + 1 >= totalPages}
                        onClick={() => setPage((p) => p + 1)}
                    >
                        Next
                    </Button>
                </Box>
            </Box>

            {events.length === 0 ? (
                <Typography>No events found for this filter.</Typography>
            ) : (
                events.map((evt, idx) => {
                    const dateObj = new Date(evt.time);
                    const isoString = dateObj.toISOString();
                    const [datePart, timePartWithZ] = isoString.split("T");
                    let timePart = "";

                    if (timePartWithZ) {
                        const [hours, minutes] = timePartWithZ.replace("Z", "").split(":");
                        timePart = `${hours}:${minutes}`;
                    }

                    const handleDidClick = () => {
                        if (evt.did) {
                            onDidClick(evt.did);
                        }
                    };

                    return (
                        <Box
                            key={idx}
                            display="flex"
                            alignItems="center"
                            gap={2}
                            sx={{
                                border: "1px solid",
                                borderColor: "divider",
                                borderRadius: 1,
                                p: 1,
                            }}
                        >
                            <Box display="flex" flexDirection="column" sx={{ minWidth: "75px" }}>
                                <Typography>{timePart}</Typography>
                                <Typography>{datePart}</Typography>
                            </Box>

                            <Typography sx={getTypeStyle(evt.operation.type)}>
                                {evt.operation.type.toUpperCase()}
                            </Typography>

                            {evt.did ? (
                                <Box display="flex" flexDirection="row">
                                    <Typography
                                        sx={{
                                            textDecoration: "underline",
                                            color: "blue",
                                            cursor: "pointer",
                                            maxWidth: 500,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                        onClick={handleDidClick}
                                        title={evt.did}
                                    >
                                        {evt.did}
                                    </Typography>
                                    <IconButton
                                        onClick={() => handleCopyDID(evt.did!, setError)}
                                        size="small"
                                        title="Copy DID"
                                    >
                                        <ContentCopy fontSize="small" />
                                    </IconButton>
                                </Box>
                            ) : (
                                <Typography>(no DID)</Typography>
                            )}

                            <Typography>{evt.registry}</Typography>
                        </Box>
                    );
                })
            )}
        </Box>
    );
}

export default Recent;