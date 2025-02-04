import React, { useState } from "react";
import { usePopupContext } from "../PopupContext";
import { Box, Button, MenuItem, Select, TextField } from "@mui/material";

function IdentitiesTab() {
    const {
        registry,
        setRegistry,
        registries,
        forceRefreshAll,
        setError,
        keymaster,
    } = usePopupContext();

    const [name, setName] = useState("");

    const handleCreateId = async () => {
        if (!name.trim()) return;
        try {
            await keymaster.createId(name.trim(), { registry });
            await forceRefreshAll();
            setName("");
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    };

    return (
        <Box className="flex-box mt-2">
            <TextField
                label="Create ID"
                variant="outlined"
                value={name}
                onChange={(e) => setName(e.target.value)}
                size="small"
                className="text-field name"
                slotProps={{
                    htmlInput: {
                        maxLength: 30,
                    },
                }}
            />

            <Select
                value={
                    registries.length > 0 && registries.includes(registry)
                        ? registry
                        : ""
                }
                onChange={(e) => setRegistry(e.target.value)}
                size="small"
                variant="outlined"
                className="select-small"
            >
                {registries.map((r) => (
                    <MenuItem key={r} value={r}>
                        {r}
                    </MenuItem>
                ))}
            </Select>

            <Button
                variant="contained"
                onClick={handleCreateId}
                size="small"
                className="button-create"
            >
                Create
            </Button>
        </Box>
    );
}

export default IdentitiesTab;
