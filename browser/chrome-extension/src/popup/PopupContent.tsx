import React, { useState } from "react";
import {
    Box,
    Switch,
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
    DarkMode,
    Key,
    LightMode,
    List,
    PermIdentity,
    MoreVert,
    Message,
} from "@mui/icons-material";
import { useWalletContext } from "../shared/contexts/WalletProvider";
import { useUIContext } from "../shared/contexts/UIContext";
import { useThemeContext } from "../shared/contexts/ContextProviders";
import IdentitiesTab from "../shared/IdentitiesTab";
import HeldTab from "../shared/HeldTab";
import AuthTab from "./components/AuthTab";
import PanelHeader from "./components/PanelHeader";
import DIDsTab from "./components/DIDsTab";
import MessageTab from "./components/MessageTab";

const PopupContent = () => {
    const {
        currentId,
    } = useWalletContext();
    const {
        openBrowserWindow,
        selectedTab,
        setSelectedTab,
    } = useUIContext();
    const {
        darkMode,
        handleDarkModeToggle,
    } = useThemeContext();

    const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);

    async function handleChange(_: React.SyntheticEvent, newValue: string) {
        await setSelectedTab(newValue);
    }

    function handleMenuOpen(event: React.MouseEvent<HTMLElement>) {
        setMenuAnchorEl(event.currentTarget);
    }

    function handleMenuClose() {
        setMenuAnchorEl(null);
    }

    function handleMenuClick(tab?: string) {
        handleMenuClose();
        openBrowserWindow({ tab });
    }

    return (
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
                    <MenuItem onClick={() => handleMenuClick("identities")}>Open Browser</MenuItem>
                    <MenuItem onClick={() => handleMenuClick("groups")}>Groups</MenuItem>
                    <MenuItem onClick={() => handleMenuClick("schemas")}>Schemas</MenuItem>
                    <MenuItem onClick={() => handleMenuClick("images")}>Images</MenuItem>
                    <MenuItem onClick={() => handleMenuClick("documents")}>Documents</MenuItem>
                    <MenuItem onClick={() => handleMenuClick("wallet")}>Wallet</MenuItem>
                    <MenuItem onClick={() => handleMenuClick("settings")}>Settings</MenuItem>
                    <MenuItem>
                        <LightMode sx={{ mr: 1 }} />
                        <Switch
                            checked={darkMode}
                            onChange={handleDarkModeToggle}
                            name="darkModeSwitch"
                        />
                        <DarkMode sx={{ ml: 1 }} />
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
                            childComponent={<HeldTab />}
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
    );
};

export default PopupContent;
