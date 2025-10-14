import React, { MouseEvent, useState } from "react";
import { TabPanel } from "@mui/lab";
import { Box, Button, Menu, MenuItem, Select, TextField } from "@mui/material";
import { ArrowDropDown, Close, ContentCopy } from "@mui/icons-material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useSnackbar } from "../../shared/contexts/SnackbarProvider";
import { useMessageContext } from "../../shared/contexts/MessageContext";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";

function MessageSendTab({ tabValue }: { tabValue: string }) {
    const [anchorEl, setAnchorEl] = useState<null | HTMLButtonElement>(null);
    const {
        registries,
        keymaster,
    } = useWalletContext();
    const {
        setError,
    } = useSnackbar();
    const {
        messageRegistry,
        setMessageRegistry,
        messageRecipient,
        setMessageRecipient,
        sendMessage,
        setSendMessage,
        encryptedDID,
        setEncryptedDID,
    } = useMessageContext();
    const {
        agentList,
    } = useCredentialsContext();

    async function clearFields() {
        await setMessageRecipient("");
        await setSendMessage("");
        await setEncryptedDID("");
    }

    const handleOpenMenu = (event: MouseEvent<HTMLButtonElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleCloseMenu = () => {
        setAnchorEl(null);
    };

    const handleSelectRecipient = async (name: string) => {
        await setMessageRecipient(name);
        handleCloseMenu();
    };

    async function encryptMessage() {
        if (!keymaster) {
            return;
        }
        try {
            const did = await keymaster.encryptMessage(
                sendMessage,
                messageRecipient,
                { registry: messageRegistry },
            );
            await setEncryptedDID(did);
        } catch (error: any) {
            setError(error);
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
                value={sendMessage}
                onChange={(e) => setSendMessage(e.target.value)}
                sx={{
                    "& .MuiOutlinedInput-root": {
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                    },
                }}
            />

            <Box className="flex-box">
                <Button
                    variant="outlined"
                    color="primary"
                    className="button large bottom"
                    onClick={encryptMessage}
                    disabled={!sendMessage || !messageRecipient}
                >
                    Encrypt
                </Button>
                <Select
                    value={registries.includes(messageRegistry) ? messageRegistry : ""}
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
                >
                    <ContentCopy />
                </Button>

                <Button
                    variant="outlined"
                    color="primary"
                    onClick={clearFields}
                    className="button large bottom"
                    disabled={
                        !sendMessage && !encryptedDID && !messageRecipient
                    }
                >
                    <Close sx={{ color: "red" }} />
                </Button>
            </Box>
        </TabPanel>
    );
}

export default MessageSendTab;
