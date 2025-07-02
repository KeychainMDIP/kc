import React, { useEffect, useMemo, useState } from "react";
import { Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    Email,
    List,
    ManageSearch,
    PermIdentity,
    Poll,
    Settings,
    Token,
} from "@mui/icons-material";
import CredentialsTab from "./components/CredentialsTab";
import WalletTab from "./components/WalletTab";
import SettingsTab from "./components/SettingsTab";
import IdentitiesTab from "../shared/IdentitiesTab";
import BrowserHeader from "./components/BrowserHeader";
import JsonViewer from "./components/JsonViewer";
import { useWalletContext } from "../shared/contexts/WalletProvider";
import { useUIContext } from "../shared/contexts/UIContext";
import { useThemeContext } from "../shared/contexts/ContextProviders";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import NamedDIDs from "./components/NamedDIDs";
import AssetsTab from "./components/AssetsTab";
import DmailTab from "./components/DmailTab";
import PollTab from "./components/PollTab";

function BrowserContent() {
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const [didRun, setDidRun] = useState<boolean>(false);
    const [refresh, setRefresh] = useState<number>(0);
    const { currentId, isBrowser } = useWalletContext();
    const { openBrowser, setOpenBrowser } = useUIContext();
    const { darkMode } = useThemeContext();

    const theme = useMemo(
        () =>
            createTheme({
                palette: { mode: darkMode ? "dark" : "light" },
            }),
        [darkMode]
    );

    const [activeTab, setActiveTab] = useState<string>("identities");
    const [activeSubTab, setActiveSubTab] = useState<string>("");
    const [assetSubTab, setAssetSubTab] = useState<string>("schemas");

    const assetTabs = ["groups", "schemas", "images", "documents", "vaults"];

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        let urlTab = urlParams.get("tab") || "";
        const urlSubTab = urlParams.get("subTab") || "";
        const urlTitle = urlParams.get("title") || "";
        const urlDid = urlParams.get("did") || "";
        const urlDoc = urlParams.get("doc");

        let initialTab = urlTab || "identities";
        let initialAssetSubTab = "schemas";

        if (assetTabs.includes(urlTab)) {
            if (currentId) {
                initialTab = "assets";
            }
            initialAssetSubTab = urlTab;
        }

        if (!currentId && (
            urlTab !== "identities" &&
            urlTab !== "wallet" &&
            urlTab !== "viewer" &&
            urlTab !== "settings"
        )) {
            initialTab = "identities";
        }

        setActiveTab(initialTab);
        setAssetSubTab(initialAssetSubTab);
        setActiveSubTab(urlSubTab);

        if (!urlDid && !urlDoc) {
            return;
        }

        let parsedContents: any = null;
        if (urlDoc) {
            try {
                parsedContents = JSON.parse(urlDoc);
            } catch (error) {}
        }

        if (setOpenBrowser) {
            setOpenBrowser({
                title: urlTitle,
                did: urlDid,
                tab: urlTab,
                subTab: urlSubTab,
                contents: parsedContents,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function toggleMenuOpen() {
        const newValue = !menuOpen;
        setMenuOpen(newValue);
        chrome.storage.local.set({ menuOpen: newValue });
    }

    useEffect(() => {
        chrome.storage.local.get(["menuOpen"], (result) => {
            if (result.menuOpen) {
                setMenuOpen(result.menuOpen);
            }
        });
    }, []);

    useEffect(() => {
        if (!isBrowser || !openBrowser) {
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
                    : tab || "viewer";
        setActiveTab(mappedTab);

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
        if (didRun || !currentId) {
            return;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const paramTab = urlParams.get("tab") || "";
        if (assetTabs.includes(paramTab)) {
            setActiveTab("assets");
            setAssetSubTab(paramTab);
        } else if (paramTab) {
            setActiveTab(paramTab);
        }
        setDidRun(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [didRun, currentId]);

    const handleTabChange = (_: React.SyntheticEvent, newValue: string) => {
        setActiveTab(newValue);
        if (newValue === "assets") {
            setAssetSubTab("schemas");
        }
    };

    return (
        <ThemeProvider theme={theme}>
            <Box className="rootContainer">
                <BrowserHeader menuOpen={menuOpen} toggleMenuOpen={toggleMenuOpen} />
                <TabContext value={activeTab}>
                    <Box className="layoutContainer">
                        <Box className={`sidebar ${menuOpen ? "open" : ""}`}>
                            <TabList orientation="vertical" onChange={handleTabChange} className="tabList">
                                <Tab
                                    icon={<PermIdentity />}
                                    label={menuOpen ? "Identities" : ""}
                                    value="identities"
                                    iconPosition="start"
                                    className="sidebarTab"
                                    sx={{ gap: 0.25 }}
                                />

                                {currentId && (
                                    <Tab
                                        icon={<Email />}
                                        label={menuOpen ? "DMail" : ""}
                                        value="dmail"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}

                                {currentId && (
                                    <Tab
                                        icon={<Badge />}
                                        label={menuOpen ? "Credentials" : ""}
                                        value="credentials"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}

                                {currentId && (
                                    <Tab
                                        icon={<List />}
                                        label={menuOpen ? "Named DIDs" : ""}
                                        value="names"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}

                                {currentId && (
                                    <Tab
                                        icon={<Poll />}
                                        label={menuOpen ? "Polls" : ""}
                                        value="polls"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}

                                {currentId && (
                                    <Tab
                                        icon={<Token />}
                                        label={menuOpen ? "Assets" : ""}
                                        value="assets"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}

                                <Tab
                                    icon={<AccountBalanceWallet />}
                                    label={menuOpen ? "Wallet" : ""}
                                    value="wallet"
                                    iconPosition="start"
                                    className="sidebarTab"
                                    sx={{ gap: 0.25 }}
                                />

                                <Tab
                                    icon={<ManageSearch />}
                                    label={menuOpen ? "JSON Viewer" : ""}
                                    value="viewer"
                                    iconPosition="start"
                                    className="sidebarTab"
                                    sx={{ gap: 0.25, whiteSpace: "nowrap" }}
                                />

                                <Tab
                                    icon={<Settings />}
                                    label={menuOpen ? "Settings" : ""}
                                    value="settings"
                                    iconPosition="start"
                                    className="sidebarTab"
                                    sx={{ gap: 0.25 }}
                                />
                            </TabList>
                        </Box>

                        <Box className="browser-context">
                            <TabPanel value="identities" sx={{ p: 0 }}>
                                <IdentitiesTab />
                            </TabPanel>

                            {currentId && (
                                <TabPanel value="dmail" sx={{ p: 0 }}>
                                    <DmailTab />
                                </TabPanel>
                            )}

                            {currentId && (
                                <TabPanel value="credentials" sx={{ p: 0 }}>
                                    <CredentialsTab subTab={activeSubTab} refresh={refresh} />
                                </TabPanel>
                            )}

                            {currentId && (
                                <TabPanel value="names" sx={{ p: 0 }}>
                                    <NamedDIDs />
                                </TabPanel>
                            )}

                            {currentId && (
                                <TabPanel value="polls" sx={{ p: 0 }}>
                                    <PollTab />
                                </TabPanel>
                            )}

                            {currentId && (
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
                    </Box>
                </TabContext>
            </Box>
        </ThemeProvider>
    );
}

export default BrowserContent;
