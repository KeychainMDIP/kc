import React, { useEffect, useState } from "react";
import { Box, Stack, Tab, Tabs } from "@mui/material";
import { TabContext, TabPanel } from "@mui/lab";
import IssueTab from "./IssueTab";
import IssuedTab from "./IssuedTab";
import HeldTab from "../../shared/HeldTab";

function CredentialsTab({ subTab, refresh }: {subTab: string, refresh: number}) {
    const [credentialTab, setCredentialTab] = useState<string>("held");

    useEffect(() => {
        setCredentialTab(subTab || "held");
    }, [subTab, refresh])

    async function handleChange(_: React.SyntheticEvent, newValue: string) {
        setCredentialTab(newValue);
    }

    return (
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
                        label="Held"
                        value="held"
                    />

                    <Tab
                        sx={{ minWidth: "70px", px: 0 }}
                        label="Issue"
                        value="issue"
                    />

                    <Tab
                        sx={{ minWidth: "70px", px: 0 }}
                        label="Issued"
                        value="issued"
                    />
                </Tabs>
            </Box>

            <Stack spacing={0}>
                <TabPanel
                    value="held"
                    className="tab-panel"
                    sx={{ px: 0 }}
                >
                    <HeldTab />
                </TabPanel>

                <TabPanel
                    value="issue"
                    className="tab-panel"
                    sx={{ px: 0 }}
                >
                    <IssueTab />
                </TabPanel>

                <TabPanel
                    value="issued"
                    className="tab-panel"
                    sx={{ px: 0 }}
                >
                    <IssuedTab />
                </TabPanel>
            </Stack>
        </TabContext>
    );
}

export default CredentialsTab;
