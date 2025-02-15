import React, { useEffect, useState } from "react";
import { Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    ManageSearch,
    PermIdentity,
    Settings,
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

function BrowserContent() {
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const [didRun, setDidRun] = useState(false);
    const { currentId, isBrowser } = useWalletContext();
    const { jsonViewerOptions } = useUIContext();
    const { darkMode } = useThemeContext();

    const theme = createTheme({
        palette: {
            mode: darkMode ? 'dark' : 'light',
        },
    });

    const params = new URLSearchParams(window.location.search);
    const paramTab = params.get("tab") || "";
    const paramSubTab = params.get("subTab") || "";
    const paramsTitle = params.get("title") || "";
    const paramsDid = params.get("did") || "";
    const paramsDoc = params.get("doc");
    const initialTab =
        paramTab === "credentials" && !currentId
            ? "identities"
            : paramTab || "identities";
    const [viewerTitle, setViewerTitle] = useState<string>(paramsTitle);
    const [viewerDID, setViewerDID] = useState<string>(paramsDid);
    const [viewerContents, setViewerContents] = useState<any>(paramsDoc);
    const [activeSubTab, setSubActiveTab] = useState<string>(paramSubTab);
    const [activeTab, setActiveTab] = useState<string>(initialTab);

    useEffect(() => {
        if (!isBrowser || !jsonViewerOptions) {
            return;
        }

        const {title, did, tab, subTab, contents} = jsonViewerOptions;
        setViewerTitle(title);
        const useTab = tab || "viewer";
        setActiveTab(useTab);
        setViewerDID(did);
        if (subTab) {
            setSubActiveTab(subTab);
        }
        if (contents) {
            setViewerContents(contents);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [jsonViewerOptions])

    useEffect(() => {
        if (!didRun && currentId) {
            if (paramTab === "credentials") {
                setActiveTab("credentials");
            }
            setDidRun(true);
        }
    }, [didRun, paramTab, currentId]);

    const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
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
                                <Tab
                                    icon={<AccountBalanceWallet />}
                                    label={menuOpen ? "Wallet" : ""}
                                    value="wallet"
                                    iconPosition="start"
                                    className="sidebarTab"
                                    sx={{ gap: 0.25 }}
                                />
                                {viewerDID && (
                                    <Tab
                                        icon={<ManageSearch />}
                                        label={menuOpen ? "JSON Viewer" : ""}
                                        value="viewer"
                                        iconPosition="start"
                                        className="sidebarTab"
                                        sx={{ gap: 0.25 }}
                                    />
                                )}
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
                                    <CredentialsTab subTab={activeSubTab} />
                                </TabPanel>
                            )}
                            <TabPanel value="wallet" sx={{ p: 0 }}>
                                <WalletTab />
                            </TabPanel>
                            {viewerDID && (
                                <TabPanel value="viewer" sx={{ p: 0 }}>
                                    <JsonViewer title={viewerTitle} did={viewerDID} rawJson={viewerContents} />
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
