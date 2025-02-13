import React, { useState } from "react";
import {
    Box,
    Button,
    IconButton,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import WarningModal from "../../shared/WarningModal";
import { Close, ContentCopy, ManageSearch } from "@mui/icons-material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { requestBrowserRefresh } from "../../shared/sharedScripts";

function DIDsTab() {
    const [open, setOpen] = useState(false);
    const [removeDID, setRemoveDID] = useState("");
    const {
        openJSONViewer,
        handleCopyDID,
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
        refreshNames,
    } = useUIContext();

    async function clearFields() {
        await setAliasName("");
        await setAliasDID("");
    }

    async function addName() {
        try {
            await keymaster.addName(aliasName, aliasDID);
            clearFields();
            await refreshNames();
            requestBrowserRefresh(isBrowser);
        } catch (error) {
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
        try {
            await keymaster.removeName(removeDID);
            await refreshNames();
            requestBrowserRefresh(isBrowser);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }

        setOpen(false);
        setRemoveDID("");
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
                    onClick={() => openJSONViewer({ title: aliasName, did: aliasDID })}
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
                        ([name, did]: [string, any], index) => (
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
                                    <Tooltip title="Copy DID">
                                        <IconButton
                                            onClick={() => handleCopyDID(did)}
                                            size="small"
                                        >
                                            <ContentCopy fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Resolve DID">
                                        <IconButton
                                            onClick={() =>
                                                openJSONViewer({ title: name, did })
                                            }
                                            size="small"
                                        >
                                            <ManageSearch fontSize="small" />
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Remove DID">
                                        <IconButton
                                            onClick={() => {
                                                handleRemoveOpen();
                                                setRemoveDID(name);
                                            }}
                                            size="small"
                                        >
                                            <Close sx={{ color: "red" }} />
                                        </IconButton>
                                    </Tooltip>
                                </Box>
                            </Box>
                        ),
                    )}
            </Box>
        </Box>
    );
}

export default DIDsTab;
