import { useState, useEffect } from "react";
import {Box, Button, Switch, TextField, Typography} from "@mui/material";
import { DarkMode, LightMode, Save } from "@mui/icons-material";
import { useThemeContext } from "../contexts/ContextProviders";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import {
    DEFAULT_GATEKEEPER_URL,
    DEFAULT_SEARCH_SERVER_URL,
    GATEKEEPER_KEY,
    SEARCH_SERVER_KEY,
} from "../constants";

const SettingsTab = () => {
    const [gatekeeperUrl, setGatekeeperUrl] = useState<string>(DEFAULT_GATEKEEPER_URL);
    const [searchServerUrl, setSearchServerUrl] = useState<string>(DEFAULT_SEARCH_SERVER_URL);
    const {
        darkMode,
        handleDarkModeToggle,
    } = useThemeContext();
    const {
        initialiseServices,
        initialiseWallet
    } = useWalletContext();
    const { setSuccess } = useSnackbar();

    useEffect(() => {
        const init = async () => {
            try {
                const gatekeeperUrl = localStorage.getItem(GATEKEEPER_KEY);
                const searchServerUrl = localStorage.getItem(SEARCH_SERVER_KEY);
                if (gatekeeperUrl) {
                    setGatekeeperUrl(gatekeeperUrl);
                }
                if (searchServerUrl) {
                    setSearchServerUrl(searchServerUrl);
                }
            } catch (error: any) {
                console.error("Error retrieving gatekeeperUrl:", error);
            }
        };
        init();
    }, []);

    const handleSave = async () => {
        try {
            localStorage.setItem(GATEKEEPER_KEY, gatekeeperUrl);
            localStorage.setItem(SEARCH_SERVER_KEY, searchServerUrl);
            await initialiseServices();
            await initialiseWallet();
            setSuccess("Services updated");
        } catch (error: any) {
            console.error("Error saving URLs:", error);
        }
    };

    return (
        <Box
            sx={{ display: "flex", flexDirection: "column", maxWidth: "400px", mt: 1 }}
        >
            <Box sx={{ display: "flex", flexDirection: "row", alignItems: "center", mb: 2 }}>
                <Typography>Theme</Typography>
                <LightMode sx={{ ml: 2, mr: 1 }} />

                <Switch
                    checked={darkMode}
                    onChange={handleDarkModeToggle}
                    color="default"
                />

                <DarkMode sx={{ ml: 1 }} />
            </Box>

            <TextField
                label="Gatekeeper URL"
                variant="outlined"
                value={gatekeeperUrl}
                onChange={(e) => setGatekeeperUrl(e.target.value)}
                sx={{ mb: 2 }}
                className="text-field"
            />

            <TextField
                label="Search Server URL"
                variant="outlined"
                value={searchServerUrl}
                onChange={(e) => setSearchServerUrl(e.target.value)}
                sx={{ mb: 2 }}
                className="text-field"
            />

            <Button
                variant="contained"
                color="primary"
                onClick={handleSave}
                startIcon={<Save />}
                sx={{ alignSelf: "start" }}
            >
                Save
            </Button>
        </Box>
    );
};

export default SettingsTab;
