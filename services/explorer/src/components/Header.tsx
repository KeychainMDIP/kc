import React from "react";
import { Box, Typography, Switch, Tabs, Tab } from "@mui/material";
import { DarkMode, LightMode } from "@mui/icons-material";
import iconInverted from '../static/icon_inverted.png';
import { useNavigate, useLocation } from "react-router-dom";

interface HeaderProps {
    darkMode: boolean;
    handleThemeToggle: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const Header = (
    {
        darkMode,
        handleThemeToggle
    }: HeaderProps
) => {
    const navigate = useNavigate();
    const location = useLocation();

    const currentTab = location.pathname.startsWith("/events") ? "events" : "search";

    const handleTabChange = (event: React.SyntheticEvent, newValue: string) => {
        navigate("/" + newValue);
    };

    return (
        <Box
            sx={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                height: 48,
                px: 1,
            }}
        >
            <Box sx={{ display: "flex", alignItems: "center", mr: 4 }}>
                <Typography variant="h6" sx={{ mr: 2 }}>
                    MDIP
                </Typography>
                <Box
                    component="img"
                    src={iconInverted}
                    alt="MDIP"
                    sx={{ width: 32, height: 32 }}
                />
            </Box>

            <Tabs
                value={currentTab}
                onChange={handleTabChange}
                textColor="inherit"
                indicatorColor="secondary"
            >
                <Tab label="Search" value="search" />
                <Tab label="Events" value="events" />
            </Tabs>

            <Box sx={{ ml: "auto", display: "flex", alignItems: "center" }}>
                <LightMode sx={{ ml: 2, mr: 1 }} />

                <Switch
                    checked={darkMode}
                    onChange={handleThemeToggle}
                    color="default"
                />

                <DarkMode sx={{ ml: 1 }} />
            </Box>
        </Box>
    );
};

export default Header;
