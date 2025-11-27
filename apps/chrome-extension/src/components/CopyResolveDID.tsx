import React from "react";
import {
    Box,
    IconButton,
    Tooltip
} from "@mui/material";
import {
    ManageSearch
} from "@mui/icons-material";
import { useUIContext } from "../contexts/UIContext";
import CopyDID from "./CopyDID";

const CopyResolveDID = ({ did } : { did: string}) => {
    const { openBrowserWindow } = useUIContext();

    return (
        <Box display="flex" flexDirection="row">
            <CopyDID did={did} />

            <Tooltip title="Resolve">
                <span>
                    <IconButton size="small"
                        onClick={() => openBrowserWindow({ did })}
                        disabled={!did}
                    >
                        <ManageSearch fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>
        </Box>
    );
}

export default CopyResolveDID;
