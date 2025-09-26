import React from "react";
import { Box, Button, MenuItem, Select } from "@mui/material";

interface VersionNavigatorProps {
    version: number;
    maxVersion: number;
    onVersionChange: (v: number) => void;
}

const VersionNavigator: React.FC<VersionNavigatorProps> = ({version, maxVersion, onVersionChange,}) => {
    if (!maxVersion || maxVersion < 1) {
        return null;
    }

    const allVersions = Array.from({ length: maxVersion }, (_, i) => i + 1);

    const goFirst = () => onVersionChange(1);
    const goPrev = () => onVersionChange(version - 1);
    const goNext = () => onVersionChange(version + 1);
    const goLast = () => onVersionChange(maxVersion);

    return (
        <Box sx={{ display: "flex", alignItems: "center" }}>
            <Button
                variant="contained"
                onClick={goFirst}
                disabled={version === 1}
                sx={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
            >
                First
            </Button>
            <Button
                variant="contained"
                onClick={goPrev}
                disabled={version <= 1}
                sx={{ borderRadius: 0 }}
            >
                Prev
            </Button>

            <Select
                sx={{
                    width: 150,
                    height: 40,
                    borderRadius: 0,
                    "& .MuiOutlinedInput-root": { borderRadius: 0 },
                }}
                value={version}
                onChange={(e) => onVersionChange(e.target.value as number)}
            >
                {allVersions.map((ver) => (
                    <MenuItem key={ver} value={ver}>
                        version {ver}
                    </MenuItem>
                ))}
            </Select>

            <Button
                variant="contained"
                onClick={goNext}
                disabled={version >= maxVersion}
                sx={{ borderRadius: 0 }}
            >
                Next
            </Button>
            <Button
                variant="contained"
                onClick={goLast}
                disabled={version >= maxVersion}
                sx={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
            >
                Last
            </Button>
        </Box>
    );
};

export default VersionNavigator;
