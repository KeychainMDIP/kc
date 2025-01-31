import React, { useState } from 'react';
import { Box, Tab } from '@mui/material';
import { TabContext, TabList, TabPanel } from '@mui/lab';
import { AccountBalanceWallet, Badge, Menu, Settings } from '@mui/icons-material';
import CredentialsTab from './components/CredentialsTab';
import WalletTab from './components/WalletTab';
import SettingsTab from './components/SettingsTab';

function BrowserContent() {
    const { search } = window.location;
    const tabParam = new URLSearchParams(search).get('tab');
    const [activeTab, setActiveTab] = useState<string>(tabParam || "credentials");
    const [menuOpen, setMenuOpen] = useState<boolean>(false);

    const handleTabChange = (event, value) => {
        if (value === 'menu') {
            setMenuOpen((prev) => !prev);
        } else {
            setActiveTab(value);
        }
    };

    const FLEX_START = 'flex-start';

    return (
        <TabContext value={activeTab}>
            <Box sx={{ display: 'flex', height: '100vh' }}>
                <Box
                    sx={{
                        width: menuOpen ? 180 : 60,
                        display: 'flex',
                        flexDirection: 'column',
                        pt: 2,
                        transition: 'width 0.2s ease-in-out',
                        overflow: 'hidden',
                    }}
                >
                    <TabList
                        orientation="vertical"
                        onChange={handleTabChange}
                        sx={{
                            '& .MuiTabs-flexContainer': {
                                gap: 1,
                            },
                            width: '100%',
                        }}
                    >
                        <Tab
                            icon={<Menu />}
                            label={menuOpen ? 'Menu' : ''}
                            value="menu"
                            iconPosition="start"
                            sx={{
                                minHeight: 48,
                                justifyContent: FLEX_START,
                                '& .MuiSvgIcon-root': {
                                    marginRight: menuOpen ? 1 : 0,
                                },
                            }}
                        />
                        <Tab
                            icon={<Badge />}
                            label={menuOpen ? 'Credentials' : ''}
                            value="credentials"
                            iconPosition="start"
                            sx={{
                                minHeight: 48,
                                justifyContent: FLEX_START,
                                '& .MuiSvgIcon-root': {
                                    marginRight: menuOpen ? 1 : 0,
                                },
                            }}
                        />
                        <Tab
                            icon={<AccountBalanceWallet />}
                            label={menuOpen ? 'Wallet' : ''}
                            value="wallet"
                            iconPosition="start"
                            sx={{
                                minHeight: 48,
                                justifyContent: FLEX_START,
                                '& .MuiSvgIcon-root': {
                                    marginRight: menuOpen ? 1 : 0,
                                },
                            }}
                        />
                        <Tab
                            icon={<Settings />}
                            label={menuOpen ? 'Settings' : ''}
                            value="settings"
                            iconPosition="start"
                            sx={{
                                minHeight: 48,
                                justifyContent: FLEX_START,
                                '& .MuiSvgIcon-root': {
                                    marginRight: menuOpen ? 1 : 0,
                                },
                            }}
                        />
                    </TabList>
                </Box>

                <Box sx={{ flexGrow: 1, p: 2, overflow: 'auto' }}>
                    <TabPanel value="credentials">
                        <CredentialsTab />
                    </TabPanel>
                    <TabPanel value="wallet">
                        <WalletTab />
                    </TabPanel>
                    <TabPanel value="settings">
                        <SettingsTab />
                    </TabPanel>
                </Box>
            </Box>
        </TabContext>
    );
}

export default BrowserContent;
