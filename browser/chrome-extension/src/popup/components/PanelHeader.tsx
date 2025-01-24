import { TabPanel } from "@mui/lab";
import { Box, Typography } from "@mui/material";
import DropDownID from "./DropDownID";
import React from "react";

interface PanelHeaderProps {
    title: string;
    tabValue: string;
    childComponent: React.ReactNode;
}

const PanelHeader: React.FC<PanelHeaderProps> = ({
    title,
    tabValue,
    childComponent,
}) => {
    return (
        <TabPanel value={tabValue} className="tab-panel" sx={{ p: 0 }}>
            <Box className="panel-header-box">
                <Typography variant="h5" component="h5" className="tab-heading">
                    {title}
                </Typography>

                <DropDownID />
            </Box>
            {childComponent}
        </TabPanel>
    );
};

export default PanelHeader;
