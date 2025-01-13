import React from "react";
import {
    Box,
    Tabs,
    Tab,
    Typography,
    Stack,
    Snackbar,
    Alert,
} from "@mui/material";
import { TabContext, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    Key,
    PermIdentity,
} from "@mui/icons-material";
import { usePopupContext } from "./PopupContext";
import IdentitiesTab from "./components/IdentitiesTab";
import CredentialsTab from "./components/CredentialsTab";
import AuthTab from "./components/AuthTab";
import WalletTab from "./components/WalletTab";

const PopupContent = () => {
    const {
        currentId,
        handleSnackbarClose,
        snackbar,
        selectedTab,
        setSelectedTab,
    } = usePopupContext();

    const handleChange = (event: React.SyntheticEvent, newValue: string) => {
        setSelectedTab(newValue);
    };

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
                <Stack spacing={0}>
                    <Tabs
                        value={selectedTab}
                        onChange={handleChange}
                        sx={{
                            minHeight: "32px",
                            p: 0,
                            m: 0,
                        }}
                    >
                        <Tab icon={<PermIdentity />} value="identities" />
                        {currentId && (
                            <Tab icon={<Badge />} value="credentials" />
                        )}
                        {currentId && <Tab icon={<Key />} value="auth" />}
                        <Tab icon={<AccountBalanceWallet />} value="wallet" />
                    </Tabs>

                    <TabPanel
                        value="identities"
                        sx={{
                            p: 0,
                            m: 0,
                        }}
                    >
                        <Typography
                            variant="h5"
                            component="h5"
                            sx={{ mb: 2, mt: 1 }}
                        >
                            Identities
                        </Typography>
                        <IdentitiesTab />
                    </TabPanel>

                    {currentId && (
                        <TabPanel
                            value="credentials"
                            sx={{
                                p: 0,
                                m: 0,
                            }}
                        >
                            <Typography
                                variant="h5"
                                component="h5"
                                sx={{ mb: 2, mt: 1 }}
                            >
                                Credentials
                            </Typography>
                            <CredentialsTab />
                        </TabPanel>
                    )}

                    {currentId && (
                        <TabPanel
                            value="auth"
                            sx={{
                                p: 0,
                                m: 0,
                            }}
                        >
                            <Typography
                                variant="h5"
                                component="h5"
                                sx={{ mb: 2, mt: 1 }}
                            >
                                Auth
                            </Typography>
                            <AuthTab />
                        </TabPanel>
                    )}

                    <TabPanel
                        value="wallet"
                        sx={{
                            p: 0,
                            m: 0,
                        }}
                    >
                        <Typography
                            variant="h5"
                            component="h5"
                            sx={{ mb: 2, mt: 1 }}
                        >
                            Wallet
                        </Typography>
                        <WalletTab />
                    </TabPanel>
                </Stack>
            </TabContext>
        </Box>
    );
};

export default PopupContent;
