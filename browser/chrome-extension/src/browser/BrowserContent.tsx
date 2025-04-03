import React, { useEffect, useState } from "react";
import { Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    Groups,
    Image,
    ManageSearch,
    PermIdentity,
    Schema,
    Settings,
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

    const [paramTab, setParamTab] = useState<string>("");
    const [activeSubTab, setActiveSubTab] = useState<string>("");
    const [activeTab, setActiveTab] = useState<string>("identities");

    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const urlTab = urlParams.get("tab") || "";
        const urlSubTab = urlParams.get("subTab") || "";
        const urlTitle = urlParams.get("title") || "";
        const urlDid = urlParams.get("did") || "";
        const urlDoc = urlParams.get("doc");

        let initialTab = urlTab || "identities";
        if (!currentId && (urlTab === "credentials" || urlTab === "groups" || urlTab === "schemas" || urlTab === "images")) {
            initialTab = "identities";
            setParamTab(urlTab);
        }

        setActiveTab(initialTab);
        setActiveSubTab(urlSubTab);

        if (!urlDid && !urlDoc) {
            return;
        }

        let parsedContents = null;
        if (urlDoc) {
            try {
                parsedContents = JSON.parse(urlDoc);
            } catch (error: any) {
                return;
            }
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
    }, [])

    useEffect(() => {
        if (!isBrowser || !openBrowser) {
            return;
        }

        const { tab, subTab } = openBrowser;
        const useTab = tab === "credentials" && !currentId ? "identities" : tab || "viewer";
        setActiveTab(useTab);
        if (subTab) {
            setActiveSubTab(subTab);
            setRefresh(r => r + 1);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openBrowser])

    // Set active tab once current ID is loaded as the paramTab value
    // is only available after the current ID is present.
    useEffect(() => {
        if (!didRun && currentId) {
            if (paramTab) {
                setActiveTab(paramTab);
            }
            setDidRun(true);
        }
    }, [didRun, paramTab, currentId]);

    const handleTabChange = (_: React.SyntheticEvent, newValue: string) => {
        setActiveTab(newValue);
    };

    return (
        <ThemeProvider theme={theme}>
            <Box className="rootContainer">
                <BrowserHeader menuOpen={menuOpen} setMenuOpen={setMenuOpen} />
                <TabContext value={activeTab}>
                    <Box className="layoutContainer">
                        <Box className={`sidebar ${menuOpen ? "open" : ""}`}>
                            <TabList
                                orientation="vertical"
                                onChange={handleTabChange}
                                className="tabList"
                            >
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
                                        icon={<Schema />}
                                        label={menuOpen ? "Schemas" : ""}
                                        value="schemas"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}
                                {currentId && (
                                    <Tab
                                        icon={<Image />}
                                        label={menuOpen ? "Images" : ""}
                                        value="images"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}
                                {currentId && (
                                    <Tab
                                        icon={<Groups />}
                                        label={menuOpen ? "Groups" : ""}
                                        value="groups"
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
                                    sx={{
                                        gap: 0.25,
                                        whiteSpace: "nowrap",
                                    }}
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
                                <TabPanel value="schemas" sx={{ p: 0 }}>
                                    <SchemaTab />
                                </TabPanel>
                            )}
                            {currentId && (
                                <TabPanel value="images" sx={{ p: 0 }}>
                                    <ImageTab />
                                </TabPanel>
                            )}
                            <TabPanel value="wallet" sx={{ p: 0 }}>
                                <WalletTab />
                            </TabPanel>
                            <TabPanel value="viewer" sx={{ p: 0 }}>
                                <JsonViewer browserTab="viewer" showResolveField={true} />
                            </TabPanel>
                            {currentId && (
                                <TabPanel value="groups" sx={{ p: 0 }}>
                                    <GroupsTab />
                                </TabPanel>
                            )}
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
