import React from "react";
import {
    Box,
    Typography
} from "@mui/material";
import CopyResolveDID from "./CopyResolveDID";

const DisplayDID = ({ did }: { did: string }) => {
    return (
        <Box
            display="flex"
            overflow="hidden"
            alignItems="center"
        >
            <Typography
                noWrap
                sx={{
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

            <CopyResolveDID did={did} />
        </Box>
    );
};

export default DisplayDID;
