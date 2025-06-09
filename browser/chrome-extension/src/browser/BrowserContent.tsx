import React, { useEffect, useState } from "react";
import { Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    ControlPointDuplicate,
    Description,
    Groups,
    Image,
    List,
    Lock,
    ManageSearch,
    PermIdentity,
    Schema,
    Settings,
    Token,
} from "@mui/icons-material";
import CredentialsTab from "./components/CredentialsTab";
import WalletTab from "./components/WalletTab";
import SettingsTab from "./components/SettingsTab";
import IdentitiesTab from "../shared/IdentitiesTab";
import GroupsTab from "./components/GroupsTab";
import BrowserHeader from "./components/BrowserHeader";
import JsonViewer from "./components/JsonViewer";
import { useWalletContext } from "../shared/contexts/WalletProvider";
import { useUIContext } from "../shared/contexts/UIContext";
import { useThemeContext } from "../shared/contexts/ContextProviders";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import SchemaTab from "./components/SchemaTab";
import ImageTab from "./components/ImageTab";
import DocumentTab from "./components/DocumentTab";
import GroupVaultTab from "./components/GroupVaultTab";
import CloneAssetTab from "./components/CloneAssetTab";
import NamedDIDs from "./components/NamedDIDs";

function BrowserContent() {
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const [didRun, setDidRun] = useState<boolean>(false);
    const [refresh, setRefresh] = useState<number>(0);
    const { currentId, isBrowser } = useWalletContext();
    const { openBrowser, setOpenBrowser } = useUIContext();
    const { darkMode } = useThemeContext();

    const theme = createTheme({
        palette: {
            mode: darkMode ? 'dark' : 'light',
        },
    });

    const [activeTab, setActiveTab] = useState<string>("identities");
    const [activeSubTab, setActiveSubTab] = useState<string>("");
    const [assetSubTab, setAssetSubTab] = useState<string>("schemas");

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const urlTab = urlParams.get("tab") || "";
        const urlSubTab = urlParams.get("subTab") || "";
        const urlTitle = urlParams.get("title") || "";
        const urlDid = urlParams.get("did") || "";
        const urlDoc = urlParams.get("doc");

        let initialTab = urlTab || "identities";
        let initialAssetSubTab = "schemas";

        const assetTabs = ["groups", "schemas", "images", "documents", "vaults"];

        if (assetTabs.includes(urlTab)) {
            initialTab = "assets";
            initialAssetSubTab = urlTab;
        }

        if (!currentId && urlTab === "credentials") {
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

    const assetTabs = ["groups", "schemas", "images", "documents", "vaults"];

    useEffect(() => {
        if (!isBrowser || !openBrowser) {
            return;
        }

        const { tab, subTab } = openBrowser;
        const mappedTab =
            tab === "credentials" && !currentId
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

    const handleAssetTabChange = (_: React.SyntheticEvent, newValue: string) => {
        setAssetSubTab(newValue);
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
                                <TabPanel value="assets" sx={{ p: 0 }}>
                                    <TabContext value={assetSubTab}>
                                        <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                                            <TabList
                                                onChange={handleAssetTabChange}
                                                aria-label="Asset Tabs"
                                                variant="scrollable"
                                                scrollButtons="auto"
                                            >
                                                <Tab
                                                    icon={<Schema sx={{ mb: 0.5 }} />}
                                                    iconPosition="top"
                                                    value="schemas"
                                                    label="Schemas"
                                                />
                                                <Tab
                                                    icon={<Image sx={{ mb: 0.5 }} />}
                                                    iconPosition="top"
                                                    value="images"
                                                    label="Images"
                                                />
                                                <Tab
                                                    icon={<Description sx={{ mb: 0.5 }} />}
                                                    iconPosition="top"
                                                    value="documents"
                                                    label="Documents"
                                                />
                                                <Tab
                                                    icon={<Groups sx={{ mb: 0.5 }} />}
                                                    iconPosition="top"
                                                    value="groups"
                                                    label="Groups"
                                                />
                                                <Tab
                                                    icon={<Lock sx={{ mb: 0.5 }} />}
                                                    iconPosition="top"
                                                    value="vaults"
                                                    label="Vaults"
                                                />
                                                <Tab
                                                    icon={<ControlPointDuplicate sx={{ mb: 0.5 }} />}
                                                    iconPosition="top"
                                                    value="clone"
                                                    label="Clone"
                                                />
                                            </TabList>
                                        </Box>

                                        <TabPanel value="schemas" sx={{ p: 0 }}>
                                            <SchemaTab />
                                        </TabPanel>
                                        <TabPanel value="images" sx={{ p: 0 }}>
                                            <ImageTab />
                                        </TabPanel>
                                        <TabPanel value="documents" sx={{ p: 0 }}>
                                            <DocumentTab />
                                        </TabPanel>
                                        <TabPanel value="groups" sx={{ p: 0 }}>
                                            <GroupsTab />
                                        </TabPanel>
                                        <TabPanel value="vaults" sx={{ p: 0 }}>
                                            <GroupVaultTab />
                                        </TabPanel>
                                        <TabPanel value="clone" sx={{ p: 0 }}>
                                            <CloneAssetTab />
                                        </TabPanel>
                                    </TabContext>
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
