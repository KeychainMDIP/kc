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
    Tab,
} from "@mui/material";
import { TabContext, TabPanel, TabList } from "@mui/lab";
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
import { useVariablesContext } from "./contexts/VariablesProvider";
import { useUIContext } from "./contexts/UIContext";
import { useThemeContext } from "./contexts/ContextProviders";
import { useSafeArea } from "./contexts/SafeAreaContext";
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
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const { isTabletUp } = useThemeContext();

    const { currentId, validId } = useVariablesContext();
    const {
        selectedTab,
        setSelectedTab,
        openBrowser,
        pendingSubTab,
        setPendingSubTab
    } = useUIContext();
    const { darkMode } = useThemeContext();
    const { top: safeTop, bottom: safeBottom } = useSafeArea();

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

    const handleSidebarTabChange = (_: any, newValue: string) => {
        setSelectedTab(newValue);
        if (newValue === "assets" && !assetTabs.includes(assetSubTab)) {
            setAssetSubTab("schemas");
        }
    };

    const toggleMenuOpen = () => {
        setMenuOpen((prev) => !prev);
    };

    const tabPanels = (
        <>
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
        </>
    );

    const sidebarWidthCollapsed = 72;
    const sidebarWidthExpanded = 220;

    return (
        <ThemeProvider theme={theme}>
            <Box
                sx={{
                    position: "fixed",
                    maxWidth: menuOpen ? 938 : 790,
                    transition: 'max-width 0.2s ease',
                    inset: 0,
                    pt: `${safeTop}px`,
                    display: "flex",
                    flexDirection: "column",
                    bgcolor: "background.default",
                }}
            >
                <Box
                    sx={{
                        flex: 1,
                        width: "100%",
                        mx: "auto",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: 0,
                    }}
                >
                    <BrowserHeader
                        menuOpen={isTabletUp ? menuOpen : false}
                        toggleMenuOpen={isTabletUp ? toggleMenuOpen : undefined}
                    />

                    <TabContext value={selectedTab}>
                        {isTabletUp ? (
                            <Box
                                sx={{
                                    display: "flex",
                                    flex: 1,
                                    minHeight: 0,
                                    overflow: "hidden",
                                }}
                            >
                                <Box
                                    sx={{
                                        flexShrink: 0,
                                        width: menuOpen
                                            ? sidebarWidthExpanded
                                            : sidebarWidthCollapsed,
                                        transition: "width 0.2s ease",
                                        borderRight: (t) =>
                                            `1px solid ${t.palette.divider}`,
                                        bgcolor: "background.paper",
                                        py: 1,
                                        display: "flex",
                                    }}
                                >
                                    <TabList
                                        orientation="vertical"
                                        onChange={handleSidebarTabChange}
                                        sx={{
                                            width: "100%",
                                            "& .MuiTab-root": {
                                                minHeight: 44,
                                                justifyContent: menuOpen
                                                    ? "flex-start"
                                                    : "center",
                                                px: menuOpen ? 2 : 1,
                                            },
                                            "& .MuiTab-root .MuiTab-iconWrapper":
                                                {
                                                    mr: menuOpen ? 1.5 : 0,
                                                },
                                        }}
                                    >
                                        <Tab
                                            icon={<Person />}
                                            label={
                                                menuOpen ? "Identities" : ""
                                            }
                                            value="identities"
                                            iconPosition="start"
                                            sx={{ gap: 0.25 }}
                                        />

                                        {displayComponent && (
                                            <Tab
                                                icon={<Key />}
                                                label={menuOpen ? "Auth" : ""}
                                                value="auth"
                                                iconPosition="start"
                                                sx={{ gap: 0.25 }}
                                            />
                                        )}

                                        {displayComponent && (
                                            <Tab
                                                icon={<Email />}
                                                label={menuOpen ? "DMail" : ""}
                                                value="dmail"
                                                iconPosition="start"
                                                sx={{ gap: 0.25 }}
                                            />
                                        )}

                                        {displayComponent && (
                                            <Tab
                                                icon={<Badge />}
                                                label={
                                                    menuOpen
                                                        ? "Credentials"
                                                        : ""
                                                }
                                                value="credentials"
                                                iconPosition="start"
                                                sx={{ gap: 0.25 }}
                                            />
                                        )}

                                        {displayComponent && (
                                            <Tab
                                                icon={<ListIcon />}
                                                label={
                                                    menuOpen
                                                        ? "Named DIDs"
                                                        : ""
                                                }
                                                value="names"
                                                iconPosition="start"
                                                sx={{ gap: 0.25 }}
                                            />
                                        )}

                                        {displayComponent && (
                                            <Tab
                                                icon={<Poll />}
                                                label={
                                                    menuOpen ? "Polls" : ""
                                                }
                                                value="polls"
                                                iconPosition="start"
                                                sx={{ gap: 0.25 }}
                                            />
                                        )}

                                        {displayComponent && (
                                            <Tab
                                                icon={<Token />}
                                                label={
                                                    menuOpen ? "Assets" : ""
                                                }
                                                value="assets"
                                                iconPosition="start"
                                                sx={{ gap: 0.25 }}
                                            />
                                        )}

                                        <Tab
                                            icon={<AccountBalanceWallet />}
                                            label={
                                                menuOpen ? "Wallet" : ""
                                            }
                                            value="wallet"
                                            iconPosition="start"
                                            sx={{ gap: 0.25 }}
                                        />

                                        <Tab
                                            icon={<ManageSearch />}
                                            label={
                                                menuOpen
                                                    ? "JSON Viewer"
                                                    : ""
                                            }
                                            value="viewer"
                                            iconPosition="start"
                                            sx={{
                                                gap: 0.25,
                                                whiteSpace: "nowrap",
                                            }}
                                        />

                                        <Tab
                                            icon={<Settings />}
                                            label={
                                                menuOpen ? "Settings" : ""
                                            }
                                            value="settings"
                                            iconPosition="start"
                                            sx={{ gap: 0.25 }}
                                        />
                                    </TabList>
                                </Box>

                                <Box
                                    id="contentScroll"
                                    sx={{
                                        flex: 1,
                                        minWidth: 0,
                                        overflow: "auto",
                                        px: 2,
                                        py: 1,
                                    }}
                                >
                                    {tabPanels}
                                </Box>
                            </Box>
                        ) : (
                            <>
                                <Box
                                    id="contentScroll"
                                    sx={{
                                        flex: 1,
                                        overflow: "auto",
                                        WebkitOverflowScrolling: "touch",
                                        px: 1,
                                        pb: `calc(${safeBottom}px + 56px)`,
                                    }}
                                >
                                    {tabPanels}
                                </Box>

                                <BottomNavigation
                                    value={bottomNavValue}
                                    onChange={handleBottomNavChange}
                                    showLabels
                                    sx={{
                                        position: "fixed",
                                        left: 0,
                                        right: 0,
                                        bottom: 0,
                                        pb: `${safeBottom}px`,
                                        alignItems: "flex-start",
                                        minHeight: 56,
                                        bgcolor: "background.paper",
                                        borderTop: (t) =>
                                            `1px solid ${t.palette.divider}`,
                                        zIndex: (t) => t.zIndex.appBar,
                                        "& .MuiBottomNavigationAction-root": {
                                            minWidth: "auto",
                                            px: 0,
                                        },
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
                            </>
                        )}
                    </TabContext>

                    {!isTabletUp && (
                        <Dialog
                            fullScreen
                            open={moreOpen}
                            onClose={() => setMoreOpen(false)}
                        >
                            <AppBar sx={{ position: "relative" }}>
                                <Toolbar
                                    sx={{
                                        height: 80,
                                        alignItems: "flex-end",
                                        minHeight: "80px !important",
                                    }}
                                >
                                    <IconButton
                                        edge="start"
                                        color="inherit"
                                        onClick={() => setMoreOpen(false)}
                                    >
                                        <Close />
                                    </IconButton>

                                    <Typography
                                        variant="h6"
                                        component="h6"
                                        sx={{ ml: 2 }}
                                    >
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
                                <ListItemButton
                                    onClick={() => selectFromMore("auth")}
                                >
                                    <ListItemIcon>
                                        <Key />
                                    </ListItemIcon>
                                    <ListItemText primary="Auth" />
                                </ListItemButton>

                                <ListItemButton
                                    onClick={() => selectFromMore("dmail")}
                                >
                                    <ListItemIcon>
                                        <Email />
                                    </ListItemIcon>
                                    <ListItemText primary="DMail" />
                                </ListItemButton>

                                <ListItemButton
                                    onClick={() =>
                                        selectFromMore("credentials")
                                    }
                                >
                                    <ListItemIcon>
                                        <Badge />
                                    </ListItemIcon>
                                    <ListItemText primary="Credentials" />
                                </ListItemButton>

                                <ListItemButton
                                    onClick={() => selectFromMore("names")}
                                >
                                    <ListItemIcon>
                                        <ListIcon />
                                    </ListItemIcon>
                                    <ListItemText primary="Named DIDs" />
                                </ListItemButton>

                                <ListItemButton
                                    onClick={() => selectFromMore("polls")}
                                >
                                    <ListItemIcon>
                                        <Poll />
                                    </ListItemIcon>
                                    <ListItemText primary="Polls" />
                                </ListItemButton>

                                <ListItemButton
                                    onClick={() => selectFromMore("assets")}
                                >
                                    <ListItemIcon>
                                        <Token />
                                    </ListItemIcon>
                                    <ListItemText primary="Assets" />
                                </ListItemButton>
                            </List>
                        </Dialog>
                    )}
                </Box>
            </Box>
        </ThemeProvider>
    );
}

export default BrowserContent;
