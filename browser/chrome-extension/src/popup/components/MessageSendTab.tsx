import React, { useState } from "react";
import { TabPanel } from "@mui/lab";
import { Box, Button, Menu, MenuItem, Select, TextField } from "@mui/material";
import { ArrowDropDown, Close, ContentCopy } from "@mui/icons-material";
import { usePopupContext } from "../PopupContext";

function MessageSendTab({ tabValue }: { tabValue: string }) {
    const {
        agentList,
        registries,
        messageRegistry,
        setMessageRegistry,
        messageRecipient,
        setMessageRecipient,
        sendMessageString,
        setSendMessageString,
        encryptedDID,
        setEncryptedDID,
        keymaster,
        setError,
    } = usePopupContext();
    const [anchorEl, setAnchorEl] = useState(null);

    async function clearFields() {
        await setMessageRecipient("");
        await setSendMessageString("");
        await setEncryptedDID("");
    }

    const handleOpenMenu = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchorEl(null);
    };

    const handleSelectRecipient = (name) => {
        setMessageRecipient(name);
        handleCloseMenu();
    };

    async function encryptMessage() {
        try {
            const did = await keymaster.encryptMessage(
                sendMessageString,
                messageRecipient,
                { registry: messageRegistry },
            );
            await setEncryptedDID(did);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    const truncatedId =
        messageRecipient?.length > 14
            ? messageRecipient.slice(0, 14) + "..."
            : messageRecipient;

    return (
        <TabPanel value={tabValue} className="tab-panel" sx={{ p: 0, mt: 1 }}>
            <Box>
                <Button
                    className="drop-down-message-button"
                    onClick={handleOpenMenu}
                    endIcon={<ArrowDropDown />}
                    sx={{ textTransform: "none", mb: 1 }}
                    size="small"
                    variant="outlined"
                >
                    {truncatedId || "Select recipient"}
                </Button>

                <Menu
                    anchorEl={anchorEl}
                    open={Boolean(anchorEl)}
                    onClose={handleCloseMenu}
                    anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                    transformOrigin={{ vertical: "top", horizontal: "left" }}
                >
                    {agentList.map((name) => (
                        <MenuItem
                            key={name}
                            onClick={() => handleSelectRecipient(name)}
                        >
                            {name}
                        </MenuItem>
                    ))}
                </Menu>
            </Box>

            <TextField
                label="Message"
                variant="outlined"
                fullWidth
                multiline
                rows={10}
                value={sendMessageString}
                onChange={(e) => setSendMessageString(e.target.value)}
            />

            <Box className="flex-box">
                <Button
                    variant="outlined"
                    color="primary"
                    className="button large bottom"
                    onClick={encryptMessage}
                    disabled={!sendMessageString || !messageRecipient}
                >
                    Encrypt
                </Button>
                <Select
                    value={
                        registries.length > 0 &&
                        registries.includes(messageRegistry)
                            ? messageRegistry
                            : ""
                    }
                    onChange={(e) => setMessageRegistry(e.target.value)}
                    size="small"
                    variant="outlined"
                    className="select-small"
                >
                    {registries.map((r) => (
                        <MenuItem key={r} value={r}>
                            {r}
                        </MenuItem>
                    ))}
                </Select>

                <Button
                    variant="outlined"
                    color="primary"
                    className="button large bottom"
                    disabled={!encryptedDID}
                    onClick={() => {
                        navigator.clipboard
                            .writeText(encryptedDID)
                            .catch((err) => {
                                setError(err.message || String(err));
                            });
                    }}
                    startIcon={<ContentCopy />}
                />

                <Button
                    variant="outlined"
                    color="primary"
                    onClick={clearFields}
                    className="button large bottom"
                    disabled={
                        !sendMessageString && !encryptedDID && !messageRecipient
                    }
                    startIcon={<Close sx={{ color: "red" }} />}
                />
            </Box>
        </TabPanel>
    );
}

export default MessageSendTab;
