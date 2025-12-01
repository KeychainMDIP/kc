import React from "react";
import { Box, IconButton, Typography, Switch } from "@mui/material";
import { DarkMode, LightMode, Menu } from "@mui/icons-material";
import { useThemeContext } from "../contexts/ContextProviders";
import DropDownID from "./DropDownID";

const BrowserHeader = (
    {
        menuOpen,
        toggleMenuOpen
    }: {
        menuOpen: boolean,
        toggleMenuOpen: () => void,
    }) => {
    const {
        darkMode,
        handleDarkModeToggle,
    } = useThemeContext();

    return (
        <Box
            sx={{
                width: menuOpen ? 890 : 790,
                transition: 'width 0.2s ease-in-out',
                display: "flex",
                alignItems: "center",
                height: 48,
                px: 1,
            }}
        >
            <IconButton
                onClick={toggleMenuOpen}
                size="small"
                sx={{ ml: 0.25 }}
            >
                <Menu />
            </IconButton>

            <Typography variant="h6" component="h6" sx={{ ml: 4 }}>
                MDIP
            </Typography>

            <Box
                component="img"
                src="icon_inverted.png"
                alt="MDIP"
                sx={{ width: 32, height: 32, mr: 4 }}
            />

            <Box sx={{ ml: "auto", display: "flex", alignItems: "center" }}>
                <DropDownID />

                <LightMode sx={{ ml: 2, mr: 1 }} />

                <Switch
                    checked={darkMode}
                    onChange={handleDarkModeToggle}
                    color="default"
                />

                <DarkMode sx={{ ml: 1 }} />
            </Box>
        </Box>
    );
};

export default BrowserHeader;
