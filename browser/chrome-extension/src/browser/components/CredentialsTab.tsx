import React, { useState } from "react";
import { Box, Stack, Tab, Tabs } from "@mui/material";
import { TabContext, TabPanel } from "@mui/lab";
import IssueTab from "./IssueTab";

function CredentialsTab() {
    const [credentialTab, setCredentialTab] = useState("issue");

    async function handleChange(event: React.SyntheticEvent, newValue: string) {
        await setCredentialTab(newValue);
    }

    return (
        <Box>
            <TabContext value={credentialTab}>
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                >
                    <Tabs
                        value={credentialTab}
                        onChange={handleChange}
                        className="tabs"
                    >
                        <Tab
                            sx={{ minWidth: "70px", px: 0 }}
                            label="Issue"
                            value="issue"
                        />
                    </Tabs>
                </Box>

                <Stack spacing={0}>
                    <TabPanel
                        value="issue"
                        className="tab-panel"
                        sx={{ px: 0 }}
                    >
                        <IssueTab />
                    </TabPanel>
                </Stack>
            </TabContext>
        </Box>
    );
}

export default CredentialsTab;
