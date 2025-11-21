import { Box, Typography } from "@mui/material";
import DropDownID from "./DropDownID";

const BrowserHeader = () => {
    return (
        <Box
            sx={{
                display: "flex",
                alignItems: "flex-end",
            }}
        >
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
