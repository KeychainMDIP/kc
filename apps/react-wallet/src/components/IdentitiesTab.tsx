import { useState } from "react";
import { useWalletContext } from "../contexts/WalletProvider";
import { Box, Button, MenuItem, Select, TextField } from "@mui/material";
import { useUIContext } from "../contexts/UIContext";
import { useSnackbar } from "../contexts/SnackbarProvider";
import WarningModal from "../modals/WarningModal";
import TextInputModal from "../modals/TextInputModal";
import { useThemeContext } from "../contexts/ContextProviders";
import { useVariablesContext } from "../contexts/VariablesProvider";

function IdentitiesTab() {
    const [name, setName] = useState<string>("");
    const [warningModal, setWarningModal] = useState<boolean>(false);
    const [removeCalled, setRemoveCalled] = useState<boolean>(false);
    const [renameModalOpen, setRenameModalOpen] = useState<boolean>(false);
    const [recoverModalOpen, setRecoverModalOpen] = useState<boolean>(false);
    const { keymaster } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();
    const {
        refreshAll,
        resetCurrentID,
    } = useUIContext();
    const {
        currentId,
        registry,
        setRegistry,
        registries,
    } = useVariablesContext();
    const { isTabletUp } = useThemeContext();

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

    async function rotateKeys() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.rotateKeys();
            await refreshAll();
        } catch (error) {
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

            <Box sx={{ mt: 2, width: isTabletUp ? '50%' : '100%', mx: isTabletUp ? 'auto' : 0 }}>
                <Box sx={{ display: 'flex', gap: 0, width: '100%', flexWrap: 'nowrap', flexDirection: 'row' }}>
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
                {currentId && (
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', flexWrap: 'nowrap', flexDirection: 'row' }}>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleRenameId}
                        >
                            Rename
                        </Button>

                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleRemoveId}
                        >
                            Remove
                        </Button>

                        <Button
                            variant="contained"
                            color="primary"
                            onClick={backupId}
                        >
                            Backup
                        </Button>

                        <Button
                            variant="contained"
                            color="primary"
                            onClick={handleRecoverId}
                        >
                            Recover
                        </Button>

                        <Button
                            variant="contained"
                            color="primary"
                            onClick={rotateKeys}
                        >
                            Rotate
                        </Button>
                    </Box>
                )}
            </Box>
        </Box>
    );
}

export default IdentitiesTab;
