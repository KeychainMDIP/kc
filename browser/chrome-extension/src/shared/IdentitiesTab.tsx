import React, { useState } from "react";
import { useWalletContext } from "./contexts/WalletProvider";
import { Box, Button, MenuItem, Select, TextField } from "@mui/material";
import { useUIContext } from "./contexts/UIContext";

function IdentitiesTab() {
    const [name, setName] = useState("");
    const {
        registry,
        setRegistry,
        registries,
        setError,
        keymaster,
    } = useWalletContext();
    const {
        resetCurrentID,
    } = useUIContext();

    const handleCreateId = async () => {
        if (!name.trim()) return;
        try {
            await keymaster.createId(name.trim(), { registry });
            await resetCurrentID();
            setName("");
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    };

    return (
        <Box className="flex-box mt-2" sx={{ maxWidth: "400px" }}>
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
                className="button-right"
            >
                Create
            </Button>
        </Box>
    );
}

export default IdentitiesTab;
