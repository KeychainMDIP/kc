import React, { useState } from "react";
import { useWalletContext } from "./contexts/WalletProvider";
import { Box, Button, MenuItem, Select, TextField } from "@mui/material";
import { useUIContext } from "./contexts/UIContext";
import { requestBrowserRefresh } from "./sharedScripts";
import WarningModal from "./WarningModal";
import TextInputModal from "./TextInputModal";

function IdentitiesTab() {
    const [name, setName] = useState<string>("");
    const [warningModal, setWarningModal] = useState<boolean>(false);
    const [removeCalled, setRemoveCalled] = useState<boolean>(false);
    const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
    const [recoverModalOpen, setRecoverModalOpen] = useState<boolean>(false);
    const {
        currentId,
        isBrowser,
        registry,
        setRegistry,
        registries,
        setError,
        setSuccess,
        keymaster,
    } = useWalletContext();
    const {
        refreshAll,
        resetCurrentID,
    } = useUIContext();

    const handleCreateId = async () => {
        if (!keymaster) {
            return;
        }
        if (!name.trim()) {
            return;
        }
        try {
            await keymaster.createId(name.trim(), { registry });
            await resetCurrentID();
            setName("");
            requestBrowserRefresh(isBrowser);
        } catch (error: any) {
            setError(error);
        }
    };

    function handleRenameId() {
        setRenameModalOpen(true);
    }

    async function renameId(newName: string) {
        if (!keymaster) {
            return;
        }
        setRenameModalOpen(false);
        const name = newName.trim();
        if (!name) {
            setError("Name cannot be empty");
            return;
        }

        try {
            await keymaster.renameId(currentId, name);
            await refreshAll();
        } catch (error: any) {
            setError(error);
        }
    }

    const handleCloseWarningModal = () => {
        setWarningModal(false);
    };

    function handleRemoveId() {
        setWarningModal(true);
        setRemoveCalled(false);
    }

    async function removeId() {
        if (!keymaster) {
            return;
        }
        setWarningModal(false);
        // Prevents multiple removals if confirm button spammed
        if (removeCalled) {
            return;
        }
        setRemoveCalled(true);
        try {
            await keymaster.removeId(currentId);
            await refreshAll();
        } catch (error: any) {
            setError(error);
        }
    }

    async function backupId() {
        if (!keymaster) {
            return;
        }
        try {
            const ok = await keymaster.backupId(currentId);

            if (ok) {
                setSuccess(`${currentId} backup succeeded`);
            } else {
                setError(`${currentId} backup failed`);
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function handleRecoverId() {
        setRecoverModalOpen(true);
    }

    async function recoverId(did: string) {
        setRecoverModalOpen(false);
        if (!did || !keymaster) {
            return;
        }

        try {
            const response = await keymaster.recoverId(did);
            await refreshAll();
            setSuccess(response + " recovered");
        } catch (error: any) {
            setError(error);
        }
    }

    return (
        <Box>
            <WarningModal
                title="Remove Identity"
                warningText={`Are you sure you want to remove ${currentId}?`}
                isOpen={warningModal}
                onClose={handleCloseWarningModal}
                onSubmit={removeId}
            />

            <TextInputModal
                isOpen={renameModalOpen}
                title="Rename Identity"
                description={`Rename ${currentId} to`}
                label="New Name"
                confirmText="Rename"
                onSubmit={renameId}
                onClose={() => setRenameModalOpen(false)}
            />

            <TextInputModal
                isOpen={recoverModalOpen}
                title="Recover Identity"
                description="Please enter the DID"
                label="DID"
                confirmText="Recover"
                onSubmit={recoverId}
                onClose={() => setRecoverModalOpen(false)}
            />

            <Box className="flex-box mt-2">
                <TextField
                    label="Create ID"
                    variant="outlined"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    size="small"
                    className="text-field name"
                    slotProps={{
                        htmlInput: {
                            maxLength: 30,
                        },
                    }}
                />

                <Select
                    value={registries.includes(registry) ? registry : ""}
                    onChange={(e) => setRegistry(e.target.value)}
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
                    variant="contained"
                    onClick={handleCreateId}
                    size="small"
                    className="button-right"
                >
                    Create
                </Button>
            </Box>
            <Box className="flex-box mt-2">
                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleRenameId}
                    sx={{ mr: 2 }}
                >
                    Rename
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleRemoveId}
                    sx={{ mr: 2 }}
                >
                    Remove
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={backupId}
                    sx={{ mr: 2 }}
                >
                    Backup
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleRecoverId}
                    sx={{ mr: 2 }}
                >
                    Recover
                </Button>
            </Box>
        </Box>
    );
}

export default IdentitiesTab;
