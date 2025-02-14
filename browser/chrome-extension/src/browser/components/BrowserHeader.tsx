import { Box, IconButton, Typography } from "@mui/material";
import { Menu } from "@mui/icons-material";
import DropDownID from "../../shared/DropDownID";
import React from "react";

const BrowserHeader = ({
    onHamburgerClick,
}: {
    onHamburgerClick: () => void;
}) => {
    return (
        <Box
            sx={{
                display: "flex",
                alignItems: "center",
                height: 48,
                px: 1,
            }}
        >
            <IconButton
                onClick={onHamburgerClick}
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

            <DropDownID />
        </Box>
    );
};

export default BrowserHeader;
