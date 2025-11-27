import {
    Box,
    Typography
} from "@mui/material";
import CopyResolveDID from "./CopyResolveDID";

const DisplayDID = ({ did }: { did: string }) => {
    return (
        <Box
            display="flex"
            alignItems="center"
            sx={{
                width: "100%",
                minWidth: 0,
                gap: 1,
            }}
        >
            <CopyResolveDID did={did} />

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
        </Box>
    );
};

export default DisplayDID;
