import { Box, IconButton, Typography } from "@mui/material";
import { Menu } from "@mui/icons-material";
import DropDownID from "./DropDownID";

const BrowserHeader = (
    {
        menuOpen,
        toggleMenuOpen
    }: {
        menuOpen: boolean,
        toggleMenuOpen?: () => void,
    }) => {
    return (
        <Box
            sx={{
                width: menuOpen ? 928 : 780,
                maxWidth: "100%",
                transition: 'width 0.2s ease',
                display: "flex",
                alignItems: "center",
                height: 48,
                px: 1,
            }}
        >
            {toggleMenuOpen &&
                <IconButton
                    onClick={toggleMenuOpen}
                    size="small"
                    sx={{ ml: 0.25 }}
                >
                    <Menu />
                </IconButton>
            }

            <Typography variant="h6" component="h6" sx={{ ml: 2 }}>
                MDIP
            </Typography>

            <Box
                component="img"
                src="/icon_inverted.png"
                alt="MDIP"
                sx={{ width: 32, height: 32, mr: 4 }}
            />

            <Box sx={{ flexGrow: 1 }} />

            <Box sx={{ mr: 2 }}>
                <DropDownID />
            </Box>
        </Box>
    );
};

export default BrowserHeader;
