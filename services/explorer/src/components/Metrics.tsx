import React, { useEffect, useState } from "react";
import {
    Box,
    Button,
    FormControl,
    MenuItem,
    Select,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    Typography,
} from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import {
    fetchNetworkMetricSnapshot,
    type NetworkMetricSnapshot,
} from "../api/searchClient.js";
import { readinessPollIntervalMs, schemaPageSizeOptions } from "../config.js";
import { useSnackbar } from "../contexts/SnackbarProvider.js";

const today = () => new Date().toISOString().slice(0, 10);

function Metrics() {
    const { setError } = useSnackbar();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentDate = today();
    const selectedDate = searchParams.get("date") || currentDate;
    const [snapshot, setSnapshot] = useState<NetworkMetricSnapshot | null>(null);
    const [message, setMessage] = useState("Loading network snapshot...");
    const [pageSize, setPageSize] = useState(25);
    const [page, setPage] = useState(0);

    const totalPages = Math.max(1, Math.ceil((snapshot?.schemas.length ?? 0) / pageSize));
    const pagedSchemas = snapshot?.schemas.slice(page * pageSize, (page + 1) * pageSize) ?? [];

    useEffect(() => {
        let ignore = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;

        setSnapshot(null);
        setMessage("Loading network snapshot...");
        setPage(0);

        function loadSnapshot() {
            fetchNetworkMetricSnapshot(selectedDate)
                .then(result => {
                    if (ignore) {
                        return;
                    }

                    if (!result) {
                        setMessage("No network snapshot exists for this date.");
                        return;
                    }

                    setSnapshot(result);
                })
                .catch(error => {
                    if (ignore) {
                        return;
                    }

                    if (error?.response?.status === 503) {
                        setMessage("Network metrics are rebuilding...");
                        retryTimer = setTimeout(loadSnapshot, readinessPollIntervalMs);
                        return;
                    }

                    setMessage("Unable to load the network snapshot.");
                    setError(error);
                });
        }

        loadSnapshot();

        return () => {
            ignore = true;
            if (retryTimer) {
                clearTimeout(retryTimer);
            }
        };
    }, [selectedDate, setError]);

    function handleDateChange(value: string) {
        const nextParams = new URLSearchParams(searchParams);

        if (value) {
            nextParams.set("date", value);
        }
        else {
            nextParams.delete("date");
        }

        setSearchParams(nextParams);
    }

    return (
        <Box sx={{ ml: 1, mt: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, gap: 2 }}>
                <Typography variant="h6">Metrics</Typography>
                <TextField
                    label="Snapshot date (UTC)"
                    type="date"
                    size="small"
                    value={selectedDate}
                    onChange={event => handleDateChange(event.target.value)}
                    slotProps={{ htmlInput: { max: currentDate }, inputLabel: { shrink: true } }}
                />
            </Box>

            {!snapshot ? (
                <Typography>{message}</Typography>
            ) : (
                <>
                    <Typography color="text.secondary" sx={{ mb: 2 }}>
                        Cumulative through {selectedDate} (UTC)
                    </Typography>

                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
                        {[
                            {
                                label: "Agent DIDs",
                                value: snapshot.agentDidCount,
                                prefixes: snapshot.agentDidCountsByPrefix,
                            },
                            {
                                label: "Credentials",
                                value: snapshot.credentialCount,
                                prefixes: snapshot.credentialDidCountsByPrefix,
                            },
                            { label: "Schemas in use", value: snapshot.schemas.length },
                        ].map(({ label, value, prefixes }) => (
                            <Box
                                key={label}
                                sx={{
                                    border: "1px solid",
                                    borderColor: "divider",
                                    borderRadius: 1,
                                    p: 2,
                                    minWidth: 220,
                                    flex: "1 1 220px",
                                }}
                            >
                                <Typography variant="overline">{label}</Typography>
                                <Typography variant="h4">{Number(value).toLocaleString()}</Typography>
                                {prefixes && Object.entries(prefixes)
                                    .sort(([a], [b]) => a.localeCompare(b))
                                    .map(([prefix, count]) => (
                                        <Box
                                            key={prefix}
                                            sx={{ display: "flex", justifyContent: "space-between", gap: 2, mt: 0.5 }}
                                        >
                                            <Typography color="text.secondary" sx={{ fontFamily: "Courier, monospace" }}>
                                                {prefix}
                                            </Typography>
                                            <Typography>{count.toLocaleString()}</Typography>
                                        </Box>
                                    ))}
                            </Box>
                        ))}
                    </Box>

                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, gap: 2, flexWrap: "wrap" }}>
                        <Typography variant="h6">Schema usage</Typography>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
                            <FormControl size="small" sx={{ minWidth: 120 }}>
                                <Select
                                    value={pageSize}
                                    onChange={(event) => {
                                        setPageSize(event.target.value as number);
                                        setPage(0);
                                    }}
                                >
                                    {schemaPageSizeOptions.map((option) => (
                                        <MenuItem key={option} value={option}>
                                            {option}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Box display="flex" alignItems="center" gap={1}>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={page === 0}
                                    onClick={() => setPage(page - 1)}
                                >
                                    Prev
                                </Button>
                                <Typography>
                                    Page {page + 1} / {totalPages}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    disabled={page + 1 >= totalPages}
                                    onClick={() => setPage(page + 1)}
                                >
                                    Next
                                </Button>
                            </Box>
                        </Box>
                    </Box>
                    {snapshot.schemas.length === 0 ? (
                        <Typography>No credential schemas were in use on this date.</Typography>
                    ) : (
                        <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell width={70}>Rank</TableCell>
                                        <TableCell>Schema DID</TableCell>
                                        <TableCell align="right" width={140}>Credentials</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {pagedSchemas.map((schema, index) => (
                                        <TableRow key={schema.schemaDid}>
                                            <TableCell>{page * pageSize + index + 1}</TableCell>
                                            <TableCell>
                                                <Typography
                                                    component={RouterLink}
                                                    to={`/search?did=${encodeURIComponent(schema.schemaDid)}`}
                                                    title={schema.schemaDid}
                                                    sx={{
                                                        display: "block",
                                                        color: "primary.main",
                                                        fontFamily: "Courier, monospace",
                                                        overflow: "hidden",
                                                        textDecoration: "underline",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {schema.schemaDid}
                                                </Typography>
                                            </TableCell>
                                            <TableCell align="right">{schema.count.toLocaleString()}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    )}
                </>
            )}
        </Box>
    );
}

export default Metrics;
