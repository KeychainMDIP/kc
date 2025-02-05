import React from "react";
import { TabPanel } from "@mui/lab";
import { Box, Button, TextField } from "@mui/material";
import { useUIContext } from "../../shared/UIContext";

function MessageReceiveTab({ tabValue }: { tabValue: string }) {
    const {
        messageDID,
        setMessageDID,
        keymaster,
        setError,
        receiveMessage,
        setReceiveMessage,
    } = useUIContext();

    async function decryptMessage(did: string) {
        try {
            const message = await keymaster.decryptMessage(did);
            await setReceiveMessage(message);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function clearFields() {
        await setMessageDID("");
        await setReceiveMessage("");
    }

    return (
        <TabPanel value={tabValue} className="tab-panel" sx={{ p: 0, mt: 2 }}>
            <TextField
                label="Message DID"
                variant="outlined"
                value={messageDID}
                onChange={(e) => setMessageDID(e.target.value.trim())}
                size="small"
                className="text-field top"
                slotProps={{
                    htmlInput: {
                        maxLength: 80,
                    },
                }}
                sx={{ width: "100%" }}
            />

            <Box className="flex-box">
                <Button
                    variant="outlined"
                    color="primary"
                    onClick={() => decryptMessage(messageDID)}
                    className="button large bottom"
                    disabled={!messageDID}
                >
                    Decrypt
                </Button>

                <Button
                    variant="outlined"
                    color="primary"
                    onClick={clearFields}
                    className="button large bottom"
                    disabled={!messageDID}
                >
                    Clear
                </Button>
            </Box>

            <TextField
                label="Message"
                variant="outlined"
                fullWidth
                multiline
                rows={10}
                value={receiveMessage}
                slotProps={{
                    input: {
                        readOnly: true,
                    },
                }}
                sx={{ mt: 2 }}
            />
        </TabPanel>
    );
}

export default MessageReceiveTab;
