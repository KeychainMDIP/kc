import { useEffect, useMemo, useState } from "react";
import {
    Box,
    BottomNavigation,
    BottomNavigationAction,
    Dialog,
    AppBar,
    Toolbar,
    IconButton,
    Typography,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
} from "@mui/material";
import { TabContext, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    Email,
    Key,
    List as ListIcon,
    ManageSearch,
    Poll,
    Settings,
    Token,
    Person,
    MoreHoriz,
    Close,
} from "@mui/icons-material";
import CredentialsTab from "./components/CredentialsTab";
import WalletTab from "./components/WalletTab";
import SettingsTab from "./components/SettingsTab";
import IdentitiesTab from "./components/IdentitiesTab";
import BrowserHeader from "./components/BrowserHeader";
import JsonViewer from "./components/JsonViewer";
import { useWalletContext } from "./contexts/WalletProvider";
import { useUIContext } from "./contexts/UIContext";
import { useThemeContext } from "./contexts/ContextProviders";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import NamedDIDs from "./components/NamedDIDs";
import AssetsTab from "./components/AssetsTab";
import DmailTab from "./components/DmailTab";
import PollTab from "./components/PollTab";
import AuthTab from "./components/AuthTab";

function BrowserContent() {
    const [moreOpen, setMoreOpen] = useState<boolean>(false);
    const [refresh, setRefresh] = useState<number>(0);
    const [activeSubTab, setActiveSubTab] = useState<string>("");
    const [assetSubTab, setAssetSubTab] = useState<string>("schemas");
    const { currentId, validId } = useWalletContext();
    const {
        selectedTab,
        setSelectedTab,
        openBrowser,
        pendingSubTab,
        setPendingSubTab
    } = useUIContext();
    const { darkMode } = useThemeContext();

    const theme = useMemo(
        () =>
            createTheme({
                palette: { mode: darkMode ? "dark" : "light" },
            }),
        [darkMode]
    );

    const assetTabs = ["groups", "schemas", "images", "documents", "vaults"];
    const displayComponent = validId && currentId !== "";

    useEffect(() => {
        if (!openBrowser) {
            return;
        }

        const { tab, subTab, clearState } = openBrowser;

        if (clearState) {
            return;
        }

        const mappedTab =
            (
                tab !== "identities" &&
                tab !== "wallet" &&
                tab !== "viewer" &&
                tab !== "settings"
            ) && !currentId
                ? "identities"
                : assetTabs.includes(tab ?? "")
                    ? "assets"
                    : tab || "identities";

        setSelectedTab(mappedTab);

        if (assetTabs.includes(tab ?? "")) {
            setAssetSubTab(tab!);
        }

        if (subTab) {
            setActiveSubTab(subTab);
            setRefresh(r => r + 1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openBrowser]);

    useEffect(() => {
        if (selectedTab === 'credentials' && pendingSubTab) {
            setActiveSubTab(pendingSubTab);
            setPendingSubTab(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTab, pendingSubTab]);

    const bottomNavValue = useMemo(() => {
        if (selectedTab === "identities") {
            return "identities";
        }
        if (selectedTab === "wallet") {
            return "wallet";
        }
        if (selectedTab === "viewer") {
            return "viewer";
        }
        if (selectedTab === "settings") {
            return "settings";
        }
        return "more";
    }, [selectedTab]);

    const handleBottomNavChange = (_: any, value: string) => {
        if (value === "more") {
            if (displayComponent) {
                setMoreOpen(true);
            }
            return;
        }
        setSelectedTab(value);
    };

    const selectFromMore = (value: string) => {
        setSelectedTab(value);
        setMoreOpen(false);
    };

    return (
        <ThemeProvider theme={theme}>
            <Box
                sx={{
                    position: 'fixed',
                    inset: 0,
                    pt: 'env(safe-area-inset-top)',
                    display: 'flex',
                    flexDirection: 'column',
                    bgcolor: 'background.default',
                }}>

                <BrowserHeader />

                <TabContext value={selectedTab}>
                    <Box
                        id="contentScroll"
                        sx={{
                            flex: 1,
                            overflow: "auto",
                            WebkitOverflowScrolling: 'touch',
                            px: 1,
                            pb: 'calc(env(safe-area-inset-bottom, 0px) + 56px)',
                        }}
                    >
                        <TabPanel value="identities" sx={{ p: 0 }}>
                            <IdentitiesTab />
                        </TabPanel>

                        {displayComponent && (
                            <TabPanel value="auth" sx={{ p: 0 }}>
                                <AuthTab />
                            </TabPanel>
                        )}

                        {displayComponent && (
                            <TabPanel value="dmail" sx={{ p: 0 }}>
                                <DmailTab />
                            </TabPanel>
                        )}

                        {displayComponent && (
                            <TabPanel value="credentials" sx={{ p: 0 }}>
                                <CredentialsTab subTab={activeSubTab} refresh={refresh} />
                            </TabPanel>
                        )}

                        {displayComponent && (
                            <TabPanel value="names" sx={{ p: 0 }}>
                                <NamedDIDs />
                            </TabPanel>
                        )}

                        {displayComponent && (
                            <TabPanel value="polls" sx={{ p: 0 }}>
                                <PollTab />
                            </TabPanel>
                        )}

                        {displayComponent && (
                            <TabPanel value="assets" sx={{ p: 0 }}>
                                <AssetsTab subTab={assetSubTab} />
                            </TabPanel>
                        )}

                        <TabPanel value="wallet" sx={{ p: 0 }}>
                            <WalletTab />
                        </TabPanel>

                        <TabPanel value="viewer" sx={{ p: 0 }}>
                            <JsonViewer browserTab="viewer" showResolveField={true} />
                        </TabPanel>

                        <TabPanel value="settings" sx={{ p: 0 }}>
                            <SettingsTab />
                        </TabPanel>
                    </Box>
                </TabContext>

                <BottomNavigation
                    value={bottomNavValue}
                    onChange={handleBottomNavChange}
                    showLabels
                    sx={{
                        position: 'fixed',
                        left: 0,
                        right: 0,
                        bottom: 'calc(env(safe-area-inset-bottom, 0px))',
                        pb: 'env(safe-area-inset-bottom)',
                        bgcolor: 'background.paper',
                        borderTop: (t) => `1px solid ${t.palette.divider}`,
                        zIndex: (t) => t.zIndex.appBar,
                    }}
                >
                    <BottomNavigationAction
                        value="identities"
                        label="Identities"
                        icon={<Person />}
                    />
                    <BottomNavigationAction
                        value="wallet"
                        label="Wallet"
                        icon={<AccountBalanceWallet />}
                    />
                    <BottomNavigationAction
                        value="viewer"
                        label="Viewer"
                        icon={<ManageSearch />}
                    />
                    <BottomNavigationAction
                        value="settings"
                        label="Settings"
                        icon={<Settings />}
                    />
                    <BottomNavigationAction
                        value="more"
                        label="More"
                        icon={<MoreHoriz />}
                        disabled={!displayComponent}
                    />
                </BottomNavigation>

                <Dialog fullScreen open={moreOpen} onClose={() => setMoreOpen(false)}>
                    <AppBar sx={{ position: "relative" }}>
                        <Toolbar
                            sx={{
                                height: 80,
                                alignItems: "flex-end",
                                minHeight: "80px !important",
                            }}
                        >
                            <IconButton edge="start" color="inherit" onClick={() => setMoreOpen(false)} aria-label="close">
                                <Close />
                            </IconButton>

                            <Typography variant="h6" component="h6" sx={{ ml: 2 }}>
                                MDIP
                            </Typography>

                            <Box
                                component="img"
                                src="/icon_transparent.png"
                                alt="MDIP"
                                sx={{ width: 32, height: 32 }}
                            />
                        </Toolbar>
                    </AppBar>

                    <List sx={{ py: 0 }}>
                        <ListItemButton onClick={() => selectFromMore("auth")}>
                            <ListItemIcon><Key /></ListItemIcon>
                            <ListItemText primary="Auth" />
                        </ListItemButton>

                        <ListItemButton onClick={() => selectFromMore("dmail")}>
                            <ListItemIcon><Email /></ListItemIcon>
                            <ListItemText primary="DMail" />
                        </ListItemButton>

                        <ListItemButton onClick={() => selectFromMore("credentials")}>
                            <ListItemIcon><Badge /></ListItemIcon>
                            <ListItemText primary="Credentials" />
                        </ListItemButton>

                        <ListItemButton onClick={() => selectFromMore("names")}>
                            <ListItemIcon><ListIcon /></ListItemIcon>
                            <ListItemText primary="Named DIDs" />
                        </ListItemButton>

                        <ListItemButton onClick={() => selectFromMore("polls")}>
                            <ListItemIcon><Poll /></ListItemIcon>
                            <ListItemText primary="Polls" />
                        </ListItemButton>

                        <ListItemButton onClick={() => selectFromMore("assets")}>
                            <ListItemIcon><Token /></ListItemIcon>
                            <ListItemText primary="Assets" />
                        </ListItemButton>
                    </List>
                </Dialog>
            </Box>
        </ThemeProvider>
    );
}

export default BrowserContent;
