import React from "react";
import { TabPanel } from "@mui/lab";
import { Box, Button, TextField } from "@mui/material";
import { usePopupContext } from "../PopupContext";
import { Close } from "@mui/icons-material";

function MessageReceiveTab({ tabValue }: { tabValue: string }) {
    const {
        messageDID,
        setMessageDID,
        openJSONViewer,
        openBrowserTab,
        keymaster,
        setError,
    } = usePopupContext();

    async function decryptMessage(did: string) {
        try {
            const message = await keymaster.decryptMessage(did);
            openBrowserTab("Decrypted Message", messageDID, message);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function clearFields() {
        await setMessageDID("");
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
                    onClick={() =>
                        openJSONViewer("Resolve Message", messageDID)
                    }
                    className="button large bottom"
                    disabled={!messageDID}
                >
                    Resolve
                </Button>

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
                    startIcon={<Close sx={{ color: "red" }} />}
                />
            </Box>
        </TabPanel>
    );
}

export default MessageReceiveTab;
