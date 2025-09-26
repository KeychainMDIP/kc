import React, { useEffect, useState } from "react";
import { Box, Tab } from "@mui/material";
import {TabContext, TabList, TabPanel} from "@mui/lab";
import {ControlPointDuplicate, Description, Groups, Image, Lock, Schema} from "@mui/icons-material";
import SchemaTab from "./SchemaTab";
import ImageTab from "./ImageTab";
import DocumentTab from "./DocumentTab";
import GroupsTab from "./GroupsTab";
import GroupVaultTab from "./GroupVaultTab";
import CloneAssetTab from "./CloneAssetTab";

function AssetsTab({ subTab }: {subTab: string}) {
    const [assetSubTab, setAssetSubTab] = useState<string>("schemas");

    useEffect(() => {
        setAssetSubTab(subTab || "schemas");
    }, [subTab])

    async function handleAssetTabChange(_: React.SyntheticEvent, newValue: string) {
        setAssetSubTab(newValue);
    }

    return (
        <TabContext value={assetSubTab}>
            <Box
                sx={{
                    position: "sticky",
                    top: 0,
                    zIndex: (t) => t.zIndex.appBar + 1,
                    bgcolor: "background.paper",
                    pt: 1,
                }}
            >
                <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
                    <TabList
                        onChange={handleAssetTabChange}
                        aria-label="Asset Tabs"
                        variant="scrollable"
                        scrollButtons="auto"
                    >
                        <Tab
                            icon={<Schema sx={{ mb: 0.5 }} />}
                            iconPosition="top"
                            value="schemas"
                            label="Schemas"
                        />
                        <Tab
                            icon={<Image sx={{ mb: 0.5 }} />}
                            iconPosition="top"
                            value="images"
                            label="Images"
                        />
                        <Tab
                            icon={<Description sx={{ mb: 0.5 }} />}
                            iconPosition="top"
                            value="documents"
                            label="Documents"
                        />
                        <Tab
                            icon={<Groups sx={{ mb: 0.5 }} />}
                            iconPosition="top"
                            value="groups"
                            label="Groups"
                        />
                        <Tab
                            icon={<Lock sx={{ mb: 0.5 }} />}
                            iconPosition="top"
                            value="vaults"
                            label="Vaults"
                        />
                        <Tab
                            icon={<ControlPointDuplicate sx={{ mb: 0.5 }} />}
                            iconPosition="top"
                            value="clone"
                            label="Clone"
                        />
                    </TabList>
                </Box>
            </Box>

            <TabPanel value="schemas" sx={{ p: 0 }}>
                <SchemaTab />
            </TabPanel>
            <TabPanel value="images" sx={{ p: 0 }}>
                <ImageTab />
            </TabPanel>
            <TabPanel value="documents" sx={{ p: 0 }}>
                <DocumentTab />
            </TabPanel>
            <TabPanel value="groups" sx={{ p: 0 }}>
                <GroupsTab />
            </TabPanel>
            <TabPanel value="vaults" sx={{ p: 0 }}>
                <GroupVaultTab />
            </TabPanel>
            <TabPanel value="clone" sx={{ p: 0 }}>
                <CloneAssetTab />
            </TabPanel>
        </TabContext>
    );
}

export default AssetsTab;
