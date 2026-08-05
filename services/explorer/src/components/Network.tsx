import React, { useEffect, useState } from "react";
import {
    Box,
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
import { useSnackbar } from "../contexts/SnackbarProvider.js";

const today = () => new Date().toISOString().slice(0, 10);

function Network() {
    const { setError } = useSnackbar();
    const [searchParams, setSearchParams] = useSearchParams();
    const currentDate = today();
    const selectedDate = searchParams.get("date") || currentDate;
    const [snapshot, setSnapshot] = useState<NetworkMetricSnapshot | null>(null);
    const [message, setMessage] = useState("Loading network snapshot...");

    useEffect(() => {
        let ignore = false;

        setSnapshot(null);
        setMessage("Loading network snapshot...");

        fetchNetworkMetricSnapshot(selectedDate)
            .then(result => {
                if (ignore) {
                    return;
                }

                setSnapshot(result);
                if (!result) {
                    setMessage("No network snapshot exists for this date.");
                }
            })
            .catch(error => {
                if (!ignore) {
                    setMessage("Unable to load the network snapshot.");
                    setError(error);
                }
            });

        return () => {
            ignore = true;
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
                <Typography variant="h6">Network metrics</Typography>
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
                        Cumulative through {snapshot.date} (UTC)
                    </Typography>

                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
                        {[
                            ["Agent DIDs", snapshot.agentDidCount],
                            ["Credentials", snapshot.credentialCount],
                            ["Schemas in use", snapshot.schemas.length],
                        ].map(([label, value]) => (
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
                            </Box>
                        ))}
                    </Box>

                    <Typography variant="h6" sx={{ mb: 1 }}>Schema usage</Typography>
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
                                    {snapshot.schemas.map((schema, index) => (
                                        <TableRow key={schema.schemaDid}>
                                            <TableCell>{index + 1}</TableCell>
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

export default Network;
