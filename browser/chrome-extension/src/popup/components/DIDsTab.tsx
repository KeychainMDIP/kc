import React, { useState } from "react";
import {
    Box,
    Button,
    IconButton,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { usePopupContext } from "../PopupContext";
import WarningModal from "./WarningModal";
import { Close, ContentCopy, ManageSearch } from "@mui/icons-material";

function DIDsTab() {
    const {
        aliasName,
        aliasDID,
        nameList,
        openJSONViewer,
        setAliasDID,
        setAliasName,
        refreshNames,
        handleCopyDID,
        keymaster,
        setError,
    } = usePopupContext();
    const [open, setOpen] = useState(false);
    const [removeDID, setRemoveDID] = useState("");

    async function clearFields() {
        await setAliasName("");
        await setAliasDID("");
    }

    async function addName() {
        try {
            await keymaster.addName(aliasName, aliasDID);
            await refreshNames();
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
                    onClick={() => openJSONViewer(aliasName, aliasDID)}
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
                                                openJSONViewer(name, did)
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
