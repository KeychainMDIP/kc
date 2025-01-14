import React, { useState } from "react";
import { usePopupContext } from "../PopupContext";
import {
    Box,
    Button,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
    TextField,
} from "@mui/material";

function IdentitiesTab() {
    const {
        idList,
        registry,
        setRegistry,
        registries,
        refreshAll,
        selectedId,
        setSelectedId,
        setError,
        keymaster,
    } = usePopupContext();

    const [name, setName] = useState("");

    async function selectId(id: string) {
        try {
            setSelectedId(id);
            await keymaster.setCurrentId(id);
            await refreshAll();
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    const handleCreateId = async () => {
        if (!name.trim()) return;
        try {
            await keymaster.createId(name.trim(), { registry });
            await refreshAll();
            setName("");
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    };

    return (
        <Box>
            <FormControl variant="outlined" size="small" sx={{ mb: 1, mt: 2 }}>
                <InputLabel id="current-id-label">Current ID</InputLabel>
                <Select
                    labelId="current-id-label"
                    label="Current ID"
                    className="select-large"
                    size="small"
                    value={
                        idList.length > 0 && idList.includes(selectedId)
                            ? selectedId
                            : ""
                    }
                    onChange={(e) => selectId(e.target.value)}
                >
                    {idList.map((id) => (
                        <MenuItem key={id} value={id}>
                            {id}
                        </MenuItem>
                    ))}
                </Select>
            </FormControl>

            <Box className="flex-box">
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
        </Box>
    );
}

export default IdentitiesTab;
