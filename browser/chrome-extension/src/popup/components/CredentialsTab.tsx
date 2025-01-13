import React, { useState } from "react";
import { usePopupContext } from "../PopupContext";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    TextField,
    Typography,
} from "@mui/material";

function CredentialsTab() {
    const {
        heldDID,
        heldList,
        manifest,
        openBrowserTab,
        resolveId,
        refreshHeld,
        setHeldDID,
        setError,
        setWarning,
        keymaster,
    } = usePopupContext();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [removeDID, setRemoveDID] = useState("");

    async function acceptCredential() {
        try {
            const ok = await keymaster.acceptCredential(heldDID);
            console.log("heldDID: ", heldDID);
            if (ok) {
                await refreshHeld();
                setHeldDID("");
            } else {
                setWarning("Credential not accepted");
            }
        } catch (error) {
            setError(error.error || error);
        }
    }

    async function resolveCredential(did: string) {
        try {
            const doc = await keymaster.resolveDID(did);
            const contents = JSON.stringify(doc, null, 4);
            openBrowserTab("Resolved Credential", did, contents);
        } catch (error) {
            setError(error.error || error);
        }
    }

    async function decryptCredential(prefix: string, did: string) {
        try {
            const doc = await keymaster.getCredential(did);
            const contents = JSON.stringify(doc, null, 4);
            openBrowserTab(prefix + " Credential", did, contents);
        } catch (error) {
            setError(error.error || error);
        }
    }

    async function publishCredential(did: string) {
        try {
            await keymaster.publishCredential(did, { reveal: false });
            await resolveId();
            await decryptCredential("Publish", did);
        } catch (error) {
            setError(error.error || error);
        }
    }

    async function revealCredential(did: string) {
        try {
            await keymaster.publishCredential(did, { reveal: true });
            await resolveId();
            await decryptCredential("Reveal", did);
        } catch (error) {
            setError(error.error || error);
        }
    }

    async function unpublishCredential(did: string) {
        try {
            await keymaster.unpublishCredential(did);
            await resolveId();
            await decryptCredential("Unpublish", did);
        } catch (error) {
            setError(error.error || error);
        }
    }

    const handleRemoveOpen = () => {
        if (!loading) {
            setOpen(true);
        }
    };

    const handleRemoveClose = () => {
        setOpen(false);
    };

    const handleRemoveConfirm = async () => {
        setLoading(true);
        try {
            await keymaster.removeCredential(removeDID);
            await refreshHeld();
        } catch (error) {
            setError(error.error || error);
        } finally {
            setOpen(false);
            setLoading(false);
            setRemoveDID("");
        }
    };

    function credentialPublished(did: string) {
        if (!manifest) {
            return false;
        }

        if (!manifest[did]) {
            return false;
        }

        return manifest[did].credential === null;
    }

    function credentialRevealed(did: string) {
        if (!manifest) {
            return false;
        }

        if (!manifest[did]) {
            return false;
        }

        return manifest[did].credential !== null;
    }

    function credentialUnpublished(did: string) {
        if (!manifest) {
            return true;
        }

        return !manifest[did];
    }

    return (
        <Box>
            <Dialog
                open={open}
                onClose={handleRemoveClose}
                disableEnforceFocus
                disableAutoFocus
                disableScrollLock
            >
                <DialogTitle id="confirm-dialog-title">
                    {"Remove DID?"}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="confirm-dialog-description">
                        Are you sure?
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleRemoveClose}
                        color="primary"
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRemoveConfirm}
                        color="primary"
                        disabled={loading}
                        autoFocus
                    >
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>

            <Box className="flex-box">
                <TextField
                    label="Credential DID"
                    variant="outlined"
                    value={heldDID}
                    onChange={(e) => setHeldDID(e.target.value)}
                    size="small"
                    className="text-field top"
                />
            </Box>

            <Box className="flex-box">
                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => resolveCredential(heldDID)}
                    className="button large bottom"
                    disabled={!heldDID}
                >
                    Resolve
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => decryptCredential("Decrypt", heldDID)}
                    className="button large bottom"
                    disabled={!heldDID}
                >
                    Decrypt
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={acceptCredential}
                    className="button large bottom"
                    disabled={!heldDID}
                >
                    Accept
                </Button>
            </Box>

            <Box className="overflow-box">
                {heldList.map((did) => (
                    <Box key={did} className="margin-bottom">
                        <Typography className="did-mono">{did}</Typography>

                        <Box className="flex-box">
                            <Button
                                variant="outlined"
                                className="button large top"
                                onClick={() => resolveCredential(did)}
                            >
                                Resolve
                            </Button>

                            <Button
                                variant="outlined"
                                className="button large top"
                                onClick={() =>
                                    decryptCredential("Decrypt", did)
                                }
                            >
                                Decrypt
                            </Button>

                            <Button
                                variant="outlined"
                                className="button large top"
                                onClick={() => {
                                    handleRemoveOpen();
                                    setRemoveDID(did);
                                }}
                                disabled={!credentialUnpublished(did)}
                            >
                                Remove
                            </Button>
                        </Box>
                        <Box className="flex-box">
                            <Button
                                variant="outlined"
                                className="button large bottom"
                                onClick={() => publishCredential(did)}
                                disabled={credentialPublished(did)}
                            >
                                Publish
                            </Button>

                            <Button
                                variant="outlined"
                                className="button large bottom"
                                onClick={() => revealCredential(did)}
                                disabled={credentialRevealed(did)}
                            >
                                Reveal
                            </Button>

                            <Button
                                variant="outlined"
                                className="button large bottom"
                                onClick={() => unpublishCredential(did)}
                                disabled={credentialUnpublished(did)}
                            >
                                Unpublish
                            </Button>
                        </Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}

export default CredentialsTab;
