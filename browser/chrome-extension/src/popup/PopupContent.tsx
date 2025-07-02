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
    Divider,
    ListItemIcon,
    ListItemText,
} from "@mui/material";
import { TabContext } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    DarkMode,
    Description,
    Groups,
    Email,
    Image,
    Key,
    LightMode,
    Lock,
    MoreVert,
    Message,
    OpenInBrowser,
    PermIdentity,
    Poll,
    Schema,
    Settings,
} from "@mui/icons-material";
import { useWalletContext } from "../shared/contexts/WalletProvider";
import { useUIContext } from "../shared/contexts/UIContext";
import { useThemeContext } from "../shared/contexts/ContextProviders";
import IdentitiesTab from "../shared/IdentitiesTab";
import HeldTab from "../shared/HeldTab";
import AuthTab from "./components/AuthTab";
import PanelHeader from "./components/PanelHeader";
import MessageTab from "./components/MessageTab";

const denseItemSx = { minHeight: 32, pl: 1.5, pr: 2 };

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
            <Box display="flex" alignItems="center" justifyContent="space-between">
                <Tabs value={selectedTab} onChange={handleChange} className="tabs" variant="scrollable" scrollButtons="auto">
                    <Tab sx={{ minWidth: 64, px: 0 }} icon={<PermIdentity />} value="identities" />
                    {currentId && <Tab sx={{ minWidth: 64, px: 0 }} icon={<Badge />} value="credentials" />}
                    {currentId && <Tab sx={{ minWidth: 64, px: 0 }} icon={<Key />} value="auth" />}
                    {currentId && <Tab sx={{ minWidth: 64, px: 0 }} icon={<Message />} value="messages" />}
                </Tabs>

                <IconButton onClick={handleMenuOpen} size="small">
                    <MoreVert />
                </IconButton>

                <Menu
                    anchorEl={menuAnchorEl}
                    open={Boolean(menuAnchorEl)}
                    onClose={handleMenuClose}
                    MenuListProps={{ dense: true }}
                    anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                    transformOrigin={{ vertical: "top", horizontal: "right" }}
                >
                    <MenuItem onClick={() => handleMenuClick("identities")} sx={denseItemSx}>
                        <ListItemIcon>
                            <OpenInBrowser fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary="Open Browser" />
                    </MenuItem>

                    <Divider sx={{ my: 0.25 }} />

                    {currentId && (
                        <Box>
                            <MenuItem onClick={() => handleMenuClick("dmail")} sx={denseItemSx}>
                                <ListItemIcon>
                                    <Email fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary="DMail" />
                            </MenuItem>
                            <MenuItem onClick={() => handleMenuClick("documents")} sx={denseItemSx}>
                                <ListItemIcon>
                                    <Description fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary="Documents" />
                            </MenuItem>
                            <MenuItem onClick={() => handleMenuClick("groups")} sx={denseItemSx}>
                                <ListItemIcon>
                                    <Groups fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary="Groups" />
                            </MenuItem>
                            <MenuItem onClick={() => handleMenuClick("images")} sx={denseItemSx}>
                                <ListItemIcon>
                                    <Image fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary="Images" />
                            </MenuItem>
                            <MenuItem onClick={() => handleMenuClick("schemas")} sx={denseItemSx}>
                                <ListItemIcon>
                                    <Schema fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary="Schemas" />
                            </MenuItem>
                            <MenuItem onClick={() => handleMenuClick("vaults")} sx={denseItemSx}>
                                <ListItemIcon>
                                    <Lock fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary="Vaults" />
                            </MenuItem>
                            <MenuItem onClick={() => handleMenuClick("polls")} sx={denseItemSx}>
                                <ListItemIcon>
                                    <Poll fontSize="small" />
                                </ListItemIcon>
                                <ListItemText primary="Polls" />
                            </MenuItem>
                        </Box>
                    )}

                    <MenuItem onClick={() => handleMenuClick("wallet")} sx={denseItemSx}>
                        <ListItemIcon>
                            <AccountBalanceWallet fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary="Wallet" />
                    </MenuItem>

                    <Divider sx={{ my: 0.25 }} />

                    <MenuItem onClick={() => handleMenuClick("settings")} sx={denseItemSx}>
                        <ListItemIcon>
                            <Settings fontSize="small" />
                        </ListItemIcon>
                        <ListItemText primary="Settings" />
                    </MenuItem>

                    <Divider sx={{ my: 0.25 }} />

                    <MenuItem disableRipple sx={{ ...denseItemSx, justifyContent: "flex-start" }}>
                        <LightMode fontSize="small" sx={{ mr: 1 }} />
                        <Switch checked={darkMode} onChange={handleDarkModeToggle} size="small" />
                        <DarkMode fontSize="small" sx={{ ml: 1 }} />
                    </MenuItem>
                </Menu>
            </Box>

            <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                <PanelHeader title="Identities" tabValue="identities" childComponent={<IdentitiesTab />} />

                {currentId && (
                    <>
                        <PanelHeader title="Credentials" tabValue="credentials" childComponent={<HeldTab />} />
                        <PanelHeader title="Auth" tabValue="auth" childComponent={<AuthTab />} />
                        <PanelHeader title="Messages" tabValue="messages" childComponent={<MessageTab />} />
                    </>
                )}
            </Stack>
        </TabContext>
    );
};

export default PopupContent;
