import React, { useEffect, useState } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import { GatekeeperInterface, Operation } from '@mdip/gatekeeper/types';
import { getTypeStyle, handleCopyDID } from '../shared/utilities.js';
import ContentCopy from "@mui/icons-material/ContentCopy";

const networksEnv = import.meta.env.VITE_OPERATION_NETWORKS || "hyperswarm";
const networks = networksEnv.split(",").map((net: string) => net.trim());

interface QueuedOperation extends Operation {
    _network?: string;
}

function Queue(
    {
        gatekeeper,
        setError,
        onDidClick
    }: {
        gatekeeper: GatekeeperInterface;
        setError: (error: any) => void;
        onDidClick: (did: string) => void;
    }) {
    const [ops, setOps] = useState<QueuedOperation[]>([]);

    useEffect(() => {
        let isMounted = true;

        async function fetchAllQueues() {
            try {
                const allOps: Operation[] = [];
                for (const network of networks) {
                    const queueOps = await gatekeeper.getQueue(network);
                    queueOps.forEach(op => {
                        (op as QueuedOperation)._network = network;
                    });
                    allOps.push(...(queueOps as QueuedOperation[]));
                }

                if (isMounted) {
                    setOps(allOps);
                }
            } catch (err: any) {
                if (isMounted) {
                    setError(err);
                }
            }
        }

        fetchAllQueues();

        const interval = setInterval(fetchAllQueues, 1000);

        return () => {
            isMounted = false;
            clearInterval(interval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (networks.length === 0) {
        return (
            <Box sx={{ ml: 1 }}>
                <Typography>No operations networks configured</Typography>
            </Box>
        );
    }

    if (ops.length === 0 ) {
        return (
            <Box sx={{ ml: 1 }}>
                <Typography>No new operations in queue</Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ ml: 1 }}>
            <Box sx={{ mt: 2 }}>
                {ops.map((op, i) => (
                    <Box
                        key={i}
                        display="flex"
                        alignItems="center"
                        gap={2}
                        sx={{ mb: 4 }}
                    >
                        <Typography sx={getTypeStyle(op.type)}>
                            {op.type.toUpperCase()}
                        </Typography>
                        {op.did ? (
                            <Box display="flex" flexDirection="row">
                                <Typography
                                    sx={{
                                        textDecoration: "underline",
                                        color: "blue",
                                        cursor: "pointer",
                                        maxWidth: 600,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                    onClick={() => onDidClick(op.did!)}
                                >
                                    {op.did}
                                </Typography>
                                <IconButton
                                    onClick={() => handleCopyDID(op.did!, setError)}
                                    size="small"
                                    title="Copy DID"
                                >
                                    <ContentCopy fontSize="small" />
                                </IconButton>
                            </Box>
                        ) : (
                            <Typography>(no DID)</Typography>
                        )}
                        <Typography>{op._network}</Typography>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

export default Queue;
