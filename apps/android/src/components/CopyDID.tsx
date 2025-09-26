import {
    Box,
    IconButton,
    Tooltip
} from "@mui/material";
import {
    ContentCopy,
} from "@mui/icons-material";
import { useUIContext } from "../contexts/UIContext";

const CopyDID = ({ did } : { did: string}) => {
    const {
        handleCopyDID,
    } = useUIContext();

    return (
        <Box>
            <Tooltip title="Copy">
                <span>
                    <IconButton size="small"
                        onClick={() => handleCopyDID(did)}
                        disabled={!did}
                    >
                        <ContentCopy fontSize="small" />
                    </IconButton>
                </span>
            </Tooltip>

        </Box>
    );
}

export default CopyDID;
