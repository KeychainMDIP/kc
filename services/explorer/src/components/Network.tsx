import React, { useEffect, useState } from "react";
import {
    Box,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Typography,
} from "@mui/material";
import {
    fetchHyperswarmNetworkStatus,
    type HyperswarmNetworkStatus,
} from "../api/searchClient.js";
import { networkPollIntervalMs } from "../config.js";
import { useSnackbar } from "../contexts/SnackbarProvider.js";

function formatPeerId(peerId: string): string {
    return peerId.length > 20
        ? `${peerId.slice(0, 8)}…${peerId.slice(-8)}`
        : peerId || "Starting";
}

function formatTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : date.toISOString().replace("T", " ").slice(0, 19);
}

function formatCount(value: number | null): string {
    return value === null ? "Unknown" : value.toLocaleString();
}

function Network() {
    const { setError } = useSnackbar();
    const [status, setStatus] = useState<HyperswarmNetworkStatus | null>(null);
    const [message, setMessage] = useState("Loading network connections...");

    useEffect(() => {
        let ignore = false;

        async function loadStatus() {
            try {
                const result = await fetchHyperswarmNetworkStatus();
                if (!ignore) {
                    setStatus(result);
                }
            }
            catch (error: any) {
                if (!ignore) {
                    setStatus(null);
                    setMessage("Network connection information is unavailable.");
                    if (error?.response?.status !== 503) {
                        setError(error);
                    }
                }
            }
        }

        loadStatus();
        const timer = setInterval(loadStatus, networkPollIntervalMs);

        return () => {
            ignore = true;
            clearInterval(timer);
        };
    }, [setError]);

    return (
        <Box sx={{ ml: 1, mt: 2 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>Network</Typography>

            {!status ? (
                <Typography>{message}</Typography>
            ) : (
                <>
                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap", mb: 3 }}>
                        {[
                            { label: "Visible nodes", value: status.totals.visibleNodes },
                            { label: "Connected peers", value: status.totals.connectedPeers },
                            { label: "Local operations", value: status.node.operationCount },
                        ].map(({ label, value }) => (
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
                                <Typography variant="h4">{value.toLocaleString()}</Typography>
                            </Box>
                        ))}
                    </Box>

                    <Box sx={{ mb: 3 }}>
                        <Typography variant="overline">This node</Typography>
                        <Box sx={{ display: "flex", gap: 4, alignItems: "baseline", flexWrap: "wrap" }}>
                            <Typography>{status.node.name}</Typography>
                            <Typography
                                title={status.node.peerId}
                                color="text.secondary"
                                sx={{ fontFamily: "Courier, monospace" }}
                            >
                                {formatPeerId(status.node.peerId)}
                            </Typography>
                            <Typography color="text.secondary">
                                Updated {formatTimestamp(status.generatedAt)}
                            </Typography>
                        </Box>
                    </Box>

                    <Typography variant="h6" sx={{ mb: 1 }}>Connected peers</Typography>
                    {status.peers.length === 0 ? (
                        <Typography>No direct peers are currently connected.</Typography>
                    ) : (
                        <TableContainer sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell>Node</TableCell>
                                        <TableCell>Peer ID</TableCell>
                                        <TableCell align="right">Operations</TableCell>
                                        <TableCell>Last seen</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {status.peers.map(peer => (
                                        <TableRow key={peer.peerId}>
                                            <TableCell>{peer.name}</TableCell>
                                            <TableCell
                                                title={peer.peerId}
                                                sx={{ fontFamily: "Courier, monospace" }}
                                            >
                                                {formatPeerId(peer.peerId)}
                                            </TableCell>
                                            <TableCell align="right">{formatCount(peer.operationCount)}</TableCell>
                                            <TableCell>{formatTimestamp(peer.lastSeen)}</TableCell>
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
