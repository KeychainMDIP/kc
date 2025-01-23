import React, { useEffect, useState } from "react";
import {
    Box,
    Tabs,
    Tab,
    Typography,
    Stack,
    Snackbar,
    Alert,
    IconButton,
    Menu,
    MenuItem,
} from "@mui/material";
import { TabContext, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    Key,
    PermIdentity,
    MoreVert,
} from "@mui/icons-material";
import { usePopupContext } from "./PopupContext";
import IdentitiesTab from "./components/IdentitiesTab";
import CredentialsTab from "./components/CredentialsTab";
import AuthTab from "./components/AuthTab";

const PopupContent = () => {
    const {
        currentId,
        handleSnackbarClose,
        snackbar,
        selectedTab,
        setSelectedTab,
        refreshAll,
    } = usePopupContext();

    const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);

    async function handleChange(event: React.SyntheticEvent, newValue: string) {
        await setSelectedTab(newValue);
    }

    useEffect(() => {
        const init = async () => {
            await refreshAll();
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function handleMenuOpen(event: React.MouseEvent<HTMLElement>) {
        setMenuAnchorEl(event.currentTarget);
    }

    function handleMenuClose() {
        setMenuAnchorEl(null);
    }

    function handleWalletClick() {
        handleMenuClose();
        chrome.tabs.create({ url: "wallet.html" });
    }

    function handleOptionsClick() {
        handleMenuClose();
        chrome.tabs.create({ url: "options.html" });
    }

    return (
        <Box>
            <Snackbar
                open={snackbar.open}
                autoHideDuration={5000}
                onClose={handleSnackbarClose}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            >
                <Alert
                    onClose={handleSnackbarClose}
                    severity={snackbar.severity}
                    sx={{ width: "100%" }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>

            <TabContext value={selectedTab}>
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Tabs
                        value={selectedTab}
                        onChange={handleChange}
                        className="tabs"
                    >
                        <Tab icon={<PermIdentity />} value="identities" />
                        {currentId && (
                            <Tab icon={<Badge />} value="credentials" />
                        )}
                        {currentId && <Tab icon={<Key />} value="auth" />}
                    </Tabs>

                    <IconButton onClick={handleMenuOpen}>
                        <MoreVert />
                    </IconButton>

                    <Menu
                        anchorEl={menuAnchorEl}
                        open={Boolean(menuAnchorEl)}
                        onClose={handleMenuClose}
                        anchorOrigin={{
                            vertical: "bottom",
                            horizontal: "right",
                        }}
                        transformOrigin={{
                            vertical: "top",
                            horizontal: "right",
                        }}
                    >
                        <MenuItem onClick={handleWalletClick}>Wallet</MenuItem>
                        <MenuItem onClick={handleOptionsClick}>
                            Options
                        </MenuItem>
                    </Menu>
                </Box>

                <Stack spacing={0}>
                    <TabPanel
                        value="identities"
                        className="tab-panel"
                        sx={{ p: 0 }}
                    >
                        <Typography
                            variant="h5"
                            component="h5"
                            className="tab-heading"
                        >
                            Identities
                        </Typography>
                        <IdentitiesTab />
                    </TabPanel>

                    {currentId && (
                        <TabPanel
                            value="credentials"
                            className="tab-panel"
                            sx={{ p: 0 }}
                        >
                            <Typography
                                variant="h5"
                                component="h5"
                                className="tab-heading"
                            >
                                Credentials
                            </Typography>
                            <CredentialsTab />
                        </TabPanel>
                    )}

                    {currentId && (
                        <TabPanel
                            value="auth"
                            className="tab-panel"
                            sx={{ p: 0 }}
                        >
                            <Typography
                                variant="h5"
                                component="h5"
                                className="tab-heading"
                            >
                                Auth
                            </Typography>
                            <AuthTab />
                        </TabPanel>
                    )}
                </Stack>
            </TabContext>
        </Box>
    );
};

export default PopupContent;
