import React, { useState } from "react";
import {
    Box,
    Button,
    TextField,
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import WarningModal from "../../shared/WarningModal";
import JsonViewer from "./JsonViewer";
import DisplayDID from "../../shared/DisplayDID";

function IssuedTab() {
    const {
        keymaster,
        setError,
    } = useWalletContext();
    const {
        issuedEdit,
        issuedList,
        issuedString,
        issuedStringOriginal,
        selectedIssued,
        setIssuedEdit,
        setIssuedList,
        setIssuedString,
        setIssuedStringOriginal,
        setSelectedIssued,
    } = useCredentialsContext();
    const {
        setOpenBrowser
    } = useUIContext();
    const [open, setOpen] = useState<boolean>(false);
    const [revokeDID, setRevokeDID] = useState<string>("");

    async function resolveIssued(did: string) {
        if (setOpenBrowser) {
            setOpenBrowser({
                title: "",
                did,
                tab: "credentials",
                subTab: "issued",
            });
        }
        setSelectedIssued(did);
        setIssuedEdit(false);
    }

    async function decryptIssued(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            const doc = await keymaster.getCredential(did);
            setSelectedIssued(did);
            const issued = JSON.stringify(doc, null, 4);
            setIssuedStringOriginal(issued);
            setIssuedString(issued);
            setIssuedEdit(true);
        } catch (error: any) {
            setError(error);
        }
    }

    async function updateIssued(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            const credential = JSON.parse(issuedString);
            await keymaster.updateCredential(did, credential);
            await decryptIssued(did);
        } catch (error: any) {
            setError(error);
        }
    }

    async function handleRevokeConfirm() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.revokeCredential(revokeDID);
            const newIssuedList = issuedList.filter((item) => item !== revokeDID);
            setIssuedList(newIssuedList);
            if (revokeDID === selectedIssued) {
                setSelectedIssued("");
                setIssuedEdit(false);
                setIssuedString("");
                setIssuedStringOriginal("");
                if (setOpenBrowser) {
                    setOpenBrowser({
                        title: "",
                        did: "",
                        tab: "credentials",
                        subTab: "issued",
                    });
                }
            }
        } catch (error: any) {
            setError(error);
        }

        setOpen(false);
        setRevokeDID("");
    }

    const handleRevokeClose = () => {
        setOpen(false);
    };

    const handleRevokeOpen = () => {
        setOpen(true);
    };

    return (
        <Box>
            <WarningModal
                title="Revoke Credential"
                warningText="Are you sure you want to rekove the credential?"
                isOpen={open}
                onClose={handleRevokeClose}
                onSubmit={handleRevokeConfirm}
            />

            <Box sx={{ height: 300, overflowY: 'auto', mb: 2 }}>
                {issuedList && issuedList.map((did, index) => (
                    <Box
                        key={index}
                        display="flex"
                        flexDirection="column"
                        sx={{
                            mb: 2,
                            alignItems: "center",
                        }}
                    >
                        <DisplayDID did={did} />
                        <Box className="flex-row" sx={{ width: '80%'}}>
                            <Button
                                variant="contained"
                                color="primary"
                                className="button large regular"
                                onClick={() => resolveIssued(did)}
                            >
                                Resolve
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                className="button large regular"
                                onClick={() => decryptIssued(did)}
                            >
                                Decrypt
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                className="button large regular"
                                onClick={() => updateIssued(did)}
                                disabled={did !== selectedIssued || !issuedEdit || issuedString === issuedStringOriginal}
                            >
                                Update
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                className="button large regular"
                                onClick={() => {
                                    setRevokeDID(did);
                                    handleRevokeOpen();
                                }}
                            >
                                Revoke
                            </Button>
                        </Box>
                    </Box>
                ))}
            </Box>
            {selectedIssued && <>
                <DisplayDID did={selectedIssued} />
                {(issuedEdit && issuedString) ? (
                    <TextField
                        value={issuedString}
                        onChange={(e) => setIssuedString(e.target.value)}
                        multiline
                        rows={20}
                        fullWidth
                        variant="outlined"
                        slotProps={{
                            input: {
                                style: {
                                    fontSize: "1em",
                                    fontFamily: "Courier, monospace",
                                },
                            }
                        }}
                    />
                ) : (
                    <JsonViewer browserTab="credentials" browserSubTab="issued" />
                )}
            </>
            }
        </Box>
    );
}

export default IssuedTab;