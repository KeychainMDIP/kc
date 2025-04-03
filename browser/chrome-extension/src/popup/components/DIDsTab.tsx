import React, { useState } from "react";
import {
    Box,
    Button,
    IconButton,
    TextField,
    Typography,
} from "@mui/material";
import WarningModal from "../../shared/WarningModal";
import {
    Close,
    ContentCopy,
    Edit,
    ManageSearch
} from "@mui/icons-material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { requestBrowserRefresh } from "../../shared/sharedScripts";
import TextInputModal from "../../shared/TextInputModal";

function DIDsTab() {
    const [open, setOpen] = useState<boolean>(false);
    const [removeDID, setRemoveDID] = useState<string>("");
    const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");
    const [renameDID, setRenameDID] = useState<string>("");
    const {
        isBrowser,
        keymaster,
        setError,
    } = useWalletContext();
    const {
        aliasName,
        aliasDID,
        nameList,
        setAliasDID,
        setAliasName,
    } = useCredentialsContext();
    const {
        handleCopyDID,
        openBrowserWindow,
        refreshNames,
    } = useUIContext();

    async function clearFields() {
        await setAliasName("");
        await setAliasDID("");
    }

    async function addName() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.addName(aliasName, aliasDID);
            await clearFields();
            await refreshNames();
            requestBrowserRefresh(isBrowser);
        } catch (error: any) {
            setError(error.error || error.message || String(error));
        }
    }

    const handleRemoveClose = () => {
        setOpen(false);
    };

    const handleRemoveOpen = () => {
        setOpen(true);
    };

    const handleRemoveConfirm = async () => {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.removeName(removeDID);
            await refreshNames();
            requestBrowserRefresh(isBrowser);
        } catch (error: any) {
            setError(error.error || error.message || String(error));
        }

        setOpen(false);
        setRemoveDID("");
    };

    const openRenameModal = (oldName: string, did: string) => {
        setRenameOldName(oldName);
        setRenameDID(did);
        setRenameModalOpen(true);
    };

    const handleRenameSubmit = async (newName: string) => {
        setRenameModalOpen(false);

        if (!newName || newName === renameOldName || !keymaster) {
            return;
        }

        try {
            await keymaster.addName(newName, renameDID);
            await keymaster.removeName(renameOldName);
            await refreshNames();
        } catch (error: any) {
            setError(error.error || error.message || String(error));
        }
    };

    return (
        <Box>
            <WarningModal
                title="Remove Credential"
                warningText="Are you sure you want to remove the credential?"
                isOpen={open}
                onClose={handleRemoveClose}
                onSubmit={handleRemoveConfirm}
            />

            <TextInputModal
                isOpen={renameModalOpen}
                title="Rename DID"
                description={`Rename '${renameOldName}' to:`}
                label="New Name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameModalOpen(false)}
            />

            <Box className="flex-box mt-2">
                <TextField
                    label="Name"
                    variant="outlined"
                    value={aliasName}
                    onChange={(e) => setAliasName(e.target.value.trim())}
                    size="small"
                    className="text-field top-left short-name"
                    slotProps={{
                        htmlInput: {
                            maxLength: 20,
                        },
                    }}
                />
                <TextField
                    label="DID"
                    variant="outlined"
                    value={aliasDID}
                    onChange={(e) => setAliasDID(e.target.value.trim())}
                    size="small"
                    className="text-field top-right"
                    slotProps={{
                        htmlInput: {
                            maxLength: 80,
                        },
                    }}
                />
            </Box>

            <Box className="flex-box">
                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => openBrowserWindow({ title: aliasName, did: aliasDID })}
                    className="button large bottom"
                    disabled={!aliasDID}
                >
                    Resolve
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={addName}
                    className="button large bottom"
                    disabled={!aliasName || !aliasDID}
                >
                    Add
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={clearFields}
                    className="button large bottom"
                    disabled={!aliasName && !aliasDID}
                >
                    Clear
                </Button>
            </Box>

            <Box className="overflow-box">
                {nameList &&
                    Object.entries(nameList).map(
                        ([name, did]: [string, string], index) => (
                            <Box
                                key={index}
                                display="flex"
                                alignItems="center"
                                justifyContent="space-between"
                                width="100%"
                                mb={1}
                            >
                                <Typography
                                    noWrap
                                    sx={{
                                        flex: 1,
                                        maxWidth: 300,
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                    }}
                                >
                                    {name}
                                </Typography>
                                <Box display="flex" alignItems="center">
                                    <IconButton
                                        onClick={() => handleCopyDID(did)}
                                        size="small"
                                    >
                                        <ContentCopy fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                        onClick={() =>
                                            openBrowserWindow({ title: name, did })
                                        }
                                        size="small"
                                    >
                                        <ManageSearch fontSize="small" />
                                    </IconButton>
                                    <IconButton
                                        onClick={() => openRenameModal(name, did)}
                                        size="small"
                                    >
                                        <Edit />
                                    </IconButton>
                                    <IconButton
                                        onClick={() => {
                                            handleRemoveOpen();
                                            setRemoveDID(name);
                                        }}
                                        size="small"
                                    >
                                        <Close sx={{ color: "red" }} />
                                    </IconButton>
                                </Box>
                            </Box>
                        ),
                    )}
            </Box>
        </Box>
    );
}

export default DIDsTab;
