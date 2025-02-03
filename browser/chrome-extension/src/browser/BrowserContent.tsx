import React, { useEffect, useState } from "react";
import { Box, Tab } from "@mui/material";
import { TabContext, TabList, TabPanel } from "@mui/lab";
import { AccountBalanceWallet, Badge, Settings } from "@mui/icons-material";
import CredentialsTab from "./components/CredentialsTab";
import WalletTab from "./components/WalletTab";
import SettingsTab from "./components/SettingsTab";
import BrowserHeader from "./components/BrowserHeader";
import { useUIContext } from "../shared/UIContext";

function BrowserContent() {
    const { search } = window.location;
    const tabParam = new URLSearchParams(search).get("tab");
    const [activeTab, setActiveTab] = useState<string>(
        tabParam || "credentials",
    );
    const [menuOpen, setMenuOpen] = useState<boolean>(false);
    const { refreshAll } = useUIContext();

    useEffect(() => {
        const init = async () => {
            await refreshAll();
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
                                icon={<Badge />}
                                label={menuOpen ? "Credentials" : ""}
                                value="credentials"
                                iconPosition="start"
                                className="sidebarTab"
                                sx={{ gap: 0.25 }}
                            />
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

                    <Box className="mainContent">
                        <TabPanel value="credentials" sx={{ p: 0 }}>
                            <CredentialsTab />
                        </TabPanel>
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
