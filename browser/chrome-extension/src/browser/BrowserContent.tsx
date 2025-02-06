import React, { useEffect, useState } from "react";
import { Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import {
    AccountBalanceWallet,
    Badge,
    PermIdentity,
    Settings,
} from "@mui/icons-material";
import CredentialsTab from "./components/CredentialsTab";
import WalletTab from "./components/WalletTab";
import SettingsTab from "./components/SettingsTab";
import IdentitiesTab from "../shared/IdentitiesTab";
import BrowserHeader from "./components/BrowserHeader";
import { useUIContext } from "../shared/UIContext";

function BrowserContent() {
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const { currentId, refreshAll } = useUIContext();
    const { search } = window.location;
    const tabParam = new URLSearchParams(search).get("tab");
    const initialTab =
        tabParam === "credentials" && !currentId
            ? "identities"
            : tabParam || "identities";
    const [activeTab, setActiveTab] = useState<string>(initialTab);
    const [didRun, setDidRun] = useState(false);

    useEffect(() => {
        const init = async () => {
            await refreshAll();
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!didRun && currentId) {
            if (tabParam === "credentials") {
                setActiveTab("credentials");
            }
            setDidRun(true);
        }
    }, [didRun, tabParam, currentId]);

    const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
        setActiveTab(newValue);
    };

    const handleToggleMenu = () => {
        setMenuOpen((prev) => !prev);
    };

    return (
        <Box className="rootContainer">
            <BrowserHeader onHamburgerClick={handleToggleMenu} />
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
                                <CredentialsTab />
                            </TabPanel>
                        )}
                        <TabPanel value="wallet" sx={{ p: 0 }}>
                            <WalletTab />
                        </TabPanel>
                        <TabPanel value="settings" sx={{ p: 0 }}>
                            <SettingsTab />
                        </TabPanel>
                    </Box>
                </Box>
            </TabContext>
        </Box>
    );
}

export default BrowserContent;
