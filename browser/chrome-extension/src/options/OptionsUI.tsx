import React, { useState, useEffect } from "react";
import { Box, Button, TextField, Typography } from "@mui/material";
import SaveIcon from "@mui/icons-material/Save";

const OptionsUI = () => {
    const [gatekeeperUrl, setGatekeeperUrl] = useState("");

    useEffect(() => {
        const init = async () => {
            try {
                const result = await chrome.storage.sync.get(["gatekeeperUrl"]);
                setGatekeeperUrl(result.gatekeeperUrl);
            } catch (error) {
                console.error("Error retrieving gatekeeperUrl:", error);
            }
        };
        init();
    }, []);

    const handleSave = async () => {
        try {
            await chrome.storage.sync.set({ gatekeeperUrl });
        } catch (error) {
            console.error("Error saving gatekeeperUrl:", error);
        }
    };

    return (
        <Box sx={{ p: 2, maxWidth: 400 }}>
            <Typography variant="h4" gutterBottom>
                Options
            </Typography>

            <TextField
                label="Gatekeeper URL"
                variant="outlined"
                fullWidth
                value={gatekeeperUrl}
                onChange={(e) => setGatekeeperUrl(e.target.value)}
                sx={{ mb: 2 }}
            />

            <Button
                variant="contained"
                color="primary"
                onClick={handleSave}
                startIcon={<SaveIcon />}
            >
                Save
            </Button>
        </Box>
    );
};

export default OptionsUI;
