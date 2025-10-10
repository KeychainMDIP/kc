import React from "react";
import { Box, IconButton, MenuItem, Select } from "@mui/material";
import { KeyboardDoubleArrowLeft, ChevronLeft, ChevronRight, KeyboardDoubleArrowRight } from "@mui/icons-material";

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
            <IconButton onClick={goFirst} disabled={version === 1}>
                <KeyboardDoubleArrowLeft />
            </IconButton>
            <IconButton onClick={goPrev} disabled={version <= 1}>
                <ChevronLeft />
            </IconButton>

            <Select
                sx={{
                    width: 150,
                }}
                size="small"
                value={version}
                onChange={(e) => onVersionChange(Number(e.target.value))}
            >
                {allVersions.map((ver) => (
                    <MenuItem key={ver} value={ver}>
                        version {ver}
                    </MenuItem>
                ))}
            </Select>

            <IconButton onClick={goNext} disabled={version >= maxVersion}>
                <ChevronRight />
            </IconButton>
            <IconButton onClick={goLast} disabled={version >= maxVersion}>
                <KeyboardDoubleArrowRight />
            </IconButton>
        </Box>
    );
};

export default VersionNavigator;
