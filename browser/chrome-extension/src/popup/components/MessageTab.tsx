import React from "react";
import { Box, Stack, Tab, Tabs } from "@mui/material";
import MessageReceiveTab from "./MessageReceiveTab";
import MessageSendTab from "./MessageSendTab";
import { TabContext } from "@mui/lab";
import { useUIContext } from "../../shared/UIContext";

function MessageTab() {
    const { selectedMessageTab, setSelectedMessageTab } = useUIContext();

    async function handleChange(event: React.SyntheticEvent, newValue: string) {
        await setSelectedMessageTab(newValue);
    }

    return (
        <Box sx={{ mt: 1, display: "flex", flexDirection: "column" }}>
            <TabContext value={selectedMessageTab}>
                <Tabs
                    value={selectedMessageTab}
                    onChange={handleChange}
                    sx={{
                        minHeight: 0,
                        height: 32,
                    }}
                >
                    <Tab
                        sx={{ py: 0, minHeight: 0, height: 32 }}
                        label="Receive"
                        value="receive"
                    />
                    <Tab
                        sx={{ py: 0, minHeight: 0, height: 32 }}
                        label="Send"
                        value="send"
                    />
                </Tabs>

                <Stack spacing={0}>
                    <MessageReceiveTab tabValue="receive" />
                    <MessageSendTab tabValue="send" />
                </Stack>
            </TabContext>
        </Box>
    );
}

export default MessageTab;
