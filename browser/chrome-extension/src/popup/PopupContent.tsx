import React, { useEffect, useState } from "react";
import {
    Box,
    Tabs,
    Tab,
    Stack,
    IconButton,
    Menu,
    MenuItem,
} from "@mui/material";
import { TabContext } from "@mui/lab";
import {
    Badge,
    Key,
    List,
    PermIdentity,
    MoreVert,
    Message,
} from "@mui/icons-material";
import { useUIContext } from "../shared/UIContext";
import IdentitiesTab from "../shared/IdentitiesTab";
import CredentialsTab from "./components/CredentialsTab";
import AuthTab from "./components/AuthTab";
import PanelHeader from "./components/PanelHeader";
import DIDsTab from "./components/DIDsTab";
import MessageTab from "./components/MessageTab";

const PopupContent = () => {
    const { currentId, selectedTab, setSelectedTab, refreshAll } =
        useUIContext();

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
        chrome.tabs.create({ url: "browser.html?tab=wallet" });
    }

    function handleSettingsClick() {
        handleMenuClose();
        chrome.tabs.create({ url: "browser.html?tab=settings" });
    }

    return (
        <Box>
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
                        <Tab
                            sx={{ minWidth: "70px", px: 0 }}
                            icon={<PermIdentity />}
                            value="identities"
                        />
                        {currentId && (
                            <Tab
                                sx={{ minWidth: "70px", px: 0 }}
                                icon={<List />}
                                value="dids"
                            />
                        )}
                        {currentId && (
                            <Tab
                                sx={{ minWidth: "70px", px: 0 }}
                                icon={<Badge />}
                                value="credentials"
                            />
                        )}
                        {currentId && (
                            <Tab
                                sx={{ minWidth: "70px", px: 0 }}
                                icon={<Key />}
                                value="auth"
                            />
                        )}
                        {currentId && (
                            <Tab
                                sx={{ minWidth: "70px", px: 0 }}
                                icon={<Message />}
                                value="messages"
                            />
                        )}
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
                        <MenuItem onClick={handleSettingsClick}>
                            Settings
                        </MenuItem>
                    </Menu>
                </Box>

                <Stack spacing={0}>
                    <PanelHeader
                        title="Identities"
                        tabValue="identities"
                        childComponent={<IdentitiesTab />}
                    />

                    {currentId && (
                        <>
                            <PanelHeader
                                title="DID List"
                                tabValue="dids"
                                childComponent={<DIDsTab />}
                            />

                            <PanelHeader
                                title="Credentials"
                                tabValue="credentials"
                                childComponent={<CredentialsTab />}
                            />

                            <PanelHeader
                                title="Auth"
                                tabValue="auth"
                                childComponent={<AuthTab />}
                            />

                            <PanelHeader
                                title="Messages"
                                tabValue="messages"
                                childComponent={<MessageTab />}
                            />
                        </>
                    )}
                </Stack>
            </TabContext>
        </Box>
    );
};

export default PopupContent;
