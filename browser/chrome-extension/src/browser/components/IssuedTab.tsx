import React, { useState } from "react";
import {
    Box,
    Button,
    TextField,
    Typography,
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import WarningModal from "../../shared/WarningModal";

function IssuedTab() {
    const FONT_FAMILY = "Courier, monospace";
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
    const [open, setOpen] = useState(false);
    const [revokeDID, setRevokeDID] = useState("");

    async function resolveIssued(did: string) {
        try {
            const doc = await keymaster.resolveDID(did);
            setSelectedIssued(did);
            setIssuedString(JSON.stringify(doc, null, 4));
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function decryptIssued(did: string) {
        try {
            const doc = await keymaster.getCredential(did);
            setSelectedIssued(did);
            const issued = JSON.stringify(doc, null, 4);
            setIssuedStringOriginal(issued);
            setIssuedString(issued);
            setIssuedEdit(true);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function updateIssued(did: string) {
        try {
            const credential = JSON.parse(issuedString);
            await keymaster.updateCredential(did, credential);
            await decryptIssued(did);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function handleRevokeConfirm() {
        try {
            await keymaster.revokeCredential(revokeDID);
            const newIssuedList = issuedList.filter((item: any) => item !== revokeDID);
            setIssuedList(newIssuedList);
            if (revokeDID === selectedIssued) {
                setSelectedIssued("");
                setIssuedEdit(false);
                setIssuedString("");
                setIssuedStringOriginal("");
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
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
                title="Remoke Credential"
                warningText="Are you sure you want to rekove the credential?"
                isOpen={open}
                onClose={handleRevokeClose}
                onSubmit={handleRevokeConfirm}
            />

            <Box sx={{ height: 300, overflowY: 'auto', mb: 2 }}>
                {issuedList && issuedList.map((did: string, index: number) => (
                    <Box
                        key={index}
                        display="flex"
                        flexDirection="column"
                        sx={{
                            mb: 2,
                            alignItems: "center",
                        }}
                    >
                        <Typography style={{ fontSize: '1.5em', fontFamily: FONT_FAMILY }}>
                            {did}
                        </Typography>
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
            {selectedIssued && issuedString && <>
                <Typography style={{ fontSize: '1.5em', fontFamily: FONT_FAMILY }}>
                    {selectedIssued}
                </Typography>
                {issuedEdit ? (
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
                                    fontFamily: FONT_FAMILY,
                                },
                            }
                        }}
                    />

                ) : (
                    <TextField
                        value={issuedString}
                        multiline
                        rows={20}
                        fullWidth
                        variant="outlined"
                        slotProps={{
                            input: {
                                readOnly: true,
                                style: {
                                    fontSize: "1em",
                                    fontFamily: FONT_FAMILY,
                                },
                            }
                        }}
                    />
                )}
            </>
            }
        </Box>
    );
}

export default IssuedTab;