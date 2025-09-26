import React, { useState } from "react";
import { Box, Button, TextField } from "@mui/material";
import { OpenInNew } from "@mui/icons-material";
import WarningModal from "./WarningModal";
import { useWalletContext } from "./contexts/WalletProvider";
import { useCredentialsContext } from "./contexts/CredentialsProvider";
import { useUIContext } from "./contexts/UIContext";
import JsonViewer from "../browser/components/JsonViewer";
import { requestBrowserRefresh } from "./sharedScripts";
import DisplayDID from "./DisplayDID";

function HeldTab() {
    const [open, setOpen] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [removeDID, setRemoveDID] = useState<string>("");
    const {
        isBrowser,
        manifest,
        resolveDID,
        setError,
        setWarning,
        keymaster,
    } = useWalletContext();
    const {
        heldDID,
        heldList,
        setHeldDID,
    } = useCredentialsContext();
    const {
        setOpenBrowser,
        openBrowserWindow,
        refreshHeld,
    } = useUIContext();

    async function acceptCredential() {
        if (!keymaster) {
            return;
        }
        try {
            const ok = await keymaster.acceptCredential(heldDID);
            if (ok) {
                await refreshHeld();
                await setHeldDID("");
                requestBrowserRefresh(isBrowser);
            } else {
                setWarning("Credential not accepted");
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function decryptCredential(prefix: string, did: string) {
        if (!keymaster) {
            return;
        }
        try {
            const doc = await keymaster.getCredential(did);
            displayJson(prefix + " Credential", did, doc);
        } catch (error: any) {
            setError(error);
        }
    }

    async function publishCredential(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.publishCredential(did, { reveal: false });
            await resolveDID();
            await decryptCredential("Publish", did);
        } catch (error: any) {
            setError(error);
        }
    }

    async function revealCredential(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.publishCredential(did, { reveal: true });
            await resolveDID();
            await decryptCredential("Reveal", did);
        } catch (error: any) {
            setError(error);
        }
    }

    async function unpublishCredential(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.unpublishCredential(did);
            await resolveDID();
            await decryptCredential("Unpublish", did);
        } catch (error: any) {
            setError(error);
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
        if (!keymaster) {
            return;
        }
        setLoading(true);
        try {
            await keymaster.removeCredential(removeDID);
            await refreshHeld();
            requestBrowserRefresh(isBrowser);
        } catch (error: any) {
            setError(error);
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

        const castManifest = manifest[did] as { credential?: string };

        return castManifest.credential === null;
    }

    function credentialRevealed(did: string) {
        if (!manifest) {
            return false;
        }

        if (!manifest[did]) {
            return false;
        }

        const castManifest = manifest[did] as { credential?: string };

        return castManifest.credential !== null;
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
        openBrowserWindow({ tab: "credentials", subTab });
    }

    function displayJson(title: string, did: string, contents?: any) {
        if (isBrowser && setOpenBrowser) {
            setOpenBrowser({
                title,
                did,
                contents,
                tab: "credentials",
                subTab: "held",
            });
        } else {
            openBrowserWindow({title, did, contents, tab: "credentials", subTab: "held"});
        }
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

            {!isBrowser &&
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
            }

            <Box className="flex-box mt-2">
                <TextField
                    label="Accept Credential DID"
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
                    onClick={() => displayJson("Resolved Credential", heldDID)}
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

            <Box className="overflow-box" sx={{ mb: 2 }}>
                {heldList.map((did) => (
                    <Box key={did} className="margin-bottom">
                        <DisplayDID did={did} />

                        <Box className="flex-box">
                            <Button
                                variant="outlined"
                                className="button large top"
                                onClick={() => displayJson("Resolved Credential", did)}
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
            <JsonViewer browserTab="credentials" browserSubTab="held" />
        </Box>
    );
}

export default HeldTab;
