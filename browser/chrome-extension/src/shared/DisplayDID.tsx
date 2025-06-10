import React from "react";
import {
    Box,
    IconButton,
    Tooltip,
    Typography
} from "@mui/material";
import { ContentCopy } from "@mui/icons-material";
import { useUIContext } from "./contexts/UIContext";

const DisplayDID = ({ did }: { did: string }) => {
    const {
        handleCopyDID,
    } = useUIContext();

    return (
        <Box
            display="flex"
            overflow="hidden"
            alignItems="center"
        >
            <Typography
                noWrap
                sx={{
                    fontSize: '1.5em',
                    fontFamily: "Courier, monospace",
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                    flex: 1,
                }}
            >
                {did}
            </Typography>

            <Tooltip title="Copy DID">
                <IconButton
                    onClick={() => handleCopyDID(did)}
                    size="small"
                    sx={{
                        px: 0.5,
                        ml: 1,
                    }}
                >
                    <ContentCopy fontSize="small" />
                </IconButton>
            </Tooltip>
        </Box>
    );
};

export default DisplayDID;
