import React, { useState } from "react";
import { useUIContext } from "../../shared/UIContext";
import { Box, Button, TextField, Typography } from "@mui/material";
import { OpenInNew } from "@mui/icons-material";
import WarningModal from "../../shared/WarningModal";

function CredentialsTab() {
    const {
        heldDID,
        heldList,
        manifest,
        openJSONViewer,
        resolveDID,
        refreshHeld,
        setHeldDID,
        setError,
        setWarning,
        keymaster,
    } = useUIContext();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [removeDID, setRemoveDID] = useState("");

    async function acceptCredential() {
        try {
            const ok = await keymaster.acceptCredential(heldDID);
            if (ok) {
                await refreshHeld();
                await setHeldDID("");
            } else {
                setWarning("Credential not accepted");
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function decryptCredential(prefix: string, did: string) {
        try {
            const doc = await keymaster.getCredential(did);
            openJSONViewer(prefix + " Credential", did, doc);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function publishCredential(did: string) {
        try {
            await keymaster.publishCredential(did, { reveal: false });
            await resolveDID();
            await decryptCredential("Publish", did);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function revealCredential(did: string) {
        try {
            await keymaster.publishCredential(did, { reveal: true });
            await resolveDID();
            await decryptCredential("Reveal", did);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function unpublishCredential(did: string) {
        try {
            await keymaster.unpublishCredential(did);
            await resolveDID();
            await decryptCredential("Unpublish", did);
        } catch (error) {
            setError(error.error || error.message || String(error));
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
            setError(error.error || error.message || String(error));
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

    async function clearHeldDID() {
        await setHeldDID("");
    }

    function openIssueTab(subTab: string) {
        chrome.tabs.create({ url: "browser.html?tab=credentials&subTab=" + subTab });
    }

    return (
        <Box>
            <WarningModal
                title="Remove Credential"
                warningText="Are you sure you want to remove the credential?"
                isOpen={open}
                onClose={handleRemoveClose}
                onSubmit={handleRemoveConfirm}
            />

            <Box display="flex" alignItems="center" sx={{ gap: 2 }}>
                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => openIssueTab("issue")}
                    endIcon={<OpenInNew />}
                >
                    Issue
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => openIssueTab("issued")}
                    endIcon={<OpenInNew />}
                >
                    Issued
                </Button>
            </Box>

            <Box className="flex-box mt-2">
                <TextField
                    label="Add Credential DID"
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
                    onClick={() =>
                        openJSONViewer("Resolved Credential", heldDID)
                    }
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

                <Button
                    variant="contained"
                    color="primary"
                    onClick={clearHeldDID}
                    className="button large bottom"
                    disabled={!heldDID}
                >
                    Clear
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
                                onClick={() =>
                                    openJSONViewer("Resolved Credential", did)
                                }
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
