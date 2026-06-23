import { useEffect, useState } from "react";
import {
    Box,
    Button,
    IconButton,
    InputAdornment,
    MenuItem,
    Select,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { CameraAlt } from "@mui/icons-material";
import axios from "axios";
import type { Challenge } from "@mdip/keymaster/types";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useUIContext } from "../contexts/UIContext";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { scanQrCode } from "../utils/utils";
import JsonDocumentView, {
    JsonDocumentValue,
    toJsonDocumentValue,
} from "./JsonDocumentView";

function AuthTab() {
    const [authDID, setAuthDID] = useState<string>("");
    const [callback, setCallback] = useState<string>("");
    const [challenge, setChallenge] = useState<string>("");
    const [challengeSchema, setChallengeSchema] = useState<string>("");
    const [challengeAttester, setChallengeAttester] = useState<string>("");
    const [response, setResponse] = useState<string>("");
    const [authContents, setAuthContents] = useState<JsonDocumentValue | undefined>(undefined);
    const [disableSendResponse, setDisableSendResponse] = useState<boolean>(true);
    const [disableSendReceipt, setDisableSendReceipt] = useState<boolean>(true);
    const { keymaster } = useWalletContext();
    const {
        setOpenBrowser,
        pendingChallenge,
        setPendingChallenge
    } = useUIContext();
    const {
        agentList,
        schemaList,
    } = useVariablesContext();
    const {
        setError,
        setSuccess,
        setWarning,
    } = useSnackbar();

    useEffect(() => {
        if (pendingChallenge && pendingChallenge !== challenge) {
            setChallenge(pendingChallenge);
            setPendingChallenge(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingChallenge]);

    useEffect(() => {
        if (challengeSchema && !schemaList.includes(challengeSchema)) {
            setChallengeSchema("");
            setChallengeAttester("");
        }
    }, [challengeSchema, schemaList]);

    useEffect(() => {
        if (challengeAttester && !agentList.includes(challengeAttester)) {
            setChallengeAttester("");
        }
    }, [agentList, challengeAttester]);

    async function newChallenge() {
        if (!keymaster) {
            return;
        }
        try {
            const challengeData: Challenge = {};

            if (challengeSchema) {
                const credential: NonNullable<Challenge["credentials"]>[number] = {
                    schema: await resolveInputDID(challengeSchema),
                };

                if (challengeAttester) {
                    credential.issuers = [await resolveInputDID(challengeAttester)];
                }

                challengeData.credentials = [credential];
            }

            const challenge = await keymaster.createChallenge(challengeData);
            await setChallenge(challenge);
            await resolveChallenge(challenge);
        } catch (error: any) {
            setError(error);
        }
    }

    async function resolveChallenge(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            const contents = await keymaster.resolveAsset(did);
            showAuthContents(did, contents);
        } catch (error: any) {
            setError(error);
        }
    }

    async function createResponse() {
        if (!keymaster) {
            return;
        }
        try {
            await clearResponse();
            const response = await keymaster.createResponse(challenge, {
                retries: 10,
            });
            await setResponse(response);

            const asset = await keymaster.resolveAsset(challenge);
            const callback = (asset as { challenge: { callback: string } }).challenge.callback;

            await setCallback(callback);

            if (callback) {
                await setDisableSendResponse(false);
            }

            await decryptResponse(response);
        } catch (error: any) {
            setError(error);
        }
    }

    async function clearChallenge() {
        await setChallenge("");
        setChallengeSchema("");
        setChallengeAttester("");
    }

    async function resolveInputDID(id: string) {
        if (!keymaster) {
            throw new Error("Keymaster is not available");
        }

        const input = id.trim();

        if (input.startsWith("did:")) {
            return input;
        }

        const doc = await keymaster.resolveDID(input);
        const did = doc.didDocument?.id;

        if (!did) {
            throw new Error(`Cannot resolve DID: ${input}`);
        }

        return did;
    }

    async function decryptResponse(did: string) {
        if (!keymaster) {
            return;
        }
        try {
            const contents = await keymaster.decryptJSON(did);
            showAuthContents(did, contents);
        } catch (error: any) {
            setError(error);
        }
    }

    async function verifyResponse() {
        if (!keymaster) {
            return;
        }
        try {
            const verify = await keymaster.verifyResponse(response);

            if (verify.match) {
                setWarning("Response is VALID");
                setDisableSendReceipt(false);
            } else {
                setWarning("Response is NOT VALID");
                setDisableSendReceipt(true);
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function clearResponse() {
        await setResponse("");
        setDisableSendReceipt(true);
    }

    async function updateResponse(did: string) {
        await setResponse(did.trim());
        setDisableSendReceipt(true);
    }

    async function sendResponse() {
        try {
            if (!callback || !response) {
                return;
            }

            await setDisableSendResponse(true);
            await axios.post(callback, { response });
            await setCallback("");
        } catch (error: any) {
            setError(error);
        }
    }

    async function sendReceipt() {
        if (!keymaster || !response) {
            return;
        }
        try {
            setDisableSendReceipt(true);
            const receiptDIDs = await keymaster.publishChallengeReceipts(response);
            showAuthContents(response, { receiptDIDs });

            if (receiptDIDs.length === 0) {
                setWarning("No receipts to send");
            } else if (receiptDIDs.length === 1) {
                setSuccess(`Receipt sent: ${receiptDIDs[0]}`);
            } else {
                setSuccess(`Receipts sent: ${receiptDIDs.length}`);
            }
        } catch (error: any) {
            setError(error);
        }
    }

    function showAuthContents(did: string, contents: unknown) {
        setAuthDID(did);
        setAuthContents(toJsonDocumentValue(contents));
    }

    function openDIDInJsonViewer(did: string) {
        setOpenBrowser({
            did,
            tab: "viewer",
        });
    }

    async function scanChallengeQR() {
        const qr = await scanQrCode();
        if (!qr) {
            setError("Failed to scan QR code");
            return;
        }

        setChallenge(qr);
    }

    return (
        <Box>
            <Box className="flex-box mt-2">
                <TextField
                    label="Challenge"
                    variant="outlined"
                    value={challenge}
                    onChange={(e) => setChallenge(e.target.value.trim())}
                    size="small"
                    className="text-field top"
                    slotProps={{
                        htmlInput: {
                            maxLength: 80,
                        },
                        input: {
                            endAdornment: (
                                <InputAdornment position="end" sx={{ mr: "-14px", height: 40, maxHeight: "none" }}>
                                    <Tooltip title="Scan QR" placement="top">
                                        <span>
                                            <IconButton
                                                onClick={scanChallengeQR}
                                                sx={{ mr: 1 }}
                                            >
                                                <CameraAlt />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </InputAdornment>
                            ),
                        }
                    }}
                />
            </Box>

            <Box display="flex" flexDirection="column">
                <Select
                    value={challengeSchema}
                    onChange={(event) => {
                        setChallengeSchema(event.target.value);
                        if (!event.target.value) {
                            setChallengeAttester("");
                        }
                    }}
                    size="small"
                    displayEmpty
                    variant="outlined"
                    className="select-small-middle"
                >
                    <MenuItem value="">
                        <em>No credential schema</em>
                    </MenuItem>
                    {schemaList.map((name, index) => (
                        <MenuItem value={name} key={index}>
                            {name}
                        </MenuItem>
                    ))}
                </Select>
                <Select
                    value={challengeAttester}
                    onChange={(event) => setChallengeAttester(event.target.value)}
                    size="small"
                    displayEmpty
                    disabled={!challengeSchema}
                    variant="outlined"
                    className="select-small-middle"
                >
                    <MenuItem value="">
                        <em>Any attester</em>
                    </MenuItem>
                    {agentList.map((name, index) => (
                        <MenuItem value={name} key={index}>
                            {name}
                        </MenuItem>
                    ))}
                </Select>
            </Box>

            <Box className="flex-box">
                <Button
                    variant="contained"
                    color="primary"
                    onClick={newChallenge}
                    className="button large bottom"
                >
                    New
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => resolveChallenge(challenge)}
                    className="button large bottom"
                    disabled={!challenge || challenge === authDID}
                >
                    Resolve
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={createResponse}
                    className="button large bottom"
                    disabled={!challenge}
                >
                    Respond
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={clearChallenge}
                    className="button large bottom"
                    disabled={!challenge && !challengeSchema && !challengeAttester}
                >
                    Clear
                </Button>
            </Box>

            <Box className="flex-box mt-2">
                <TextField
                    label="Response"
                    variant="outlined"
                    value={response}
                    onChange={(e) => updateResponse(e.target.value)}
                    size="small"
                    className="text-field top"
                    slotProps={{
                        htmlInput: {
                            maxLength: 80,
                        },
                        input: {
                            endAdornment: (
                                <InputAdornment position="end" sx={{ mr: "-14px", height: 40, maxHeight: "none" }}>
                                    <Button
                                        variant="contained"
                                        color="primary"
                                        onClick={clearResponse}
                                        disabled={!response}
                                        sx={{
                                            borderTopLeftRadius: 0,
                                            borderBottomLeftRadius: 0,
                                            boxShadow: "none",
                                            height: 40,
                                        }}
                                    >
                                        Clear
                                    </Button>
                                </InputAdornment>
                            ),
                        }
                    }}
                />
            </Box>

            <Box className="flex-box">
                <Button
                    variant="contained"
                    color="primary"
                    onClick={() => decryptResponse(response)}
                    className="button large bottom"
                    disabled={!response || response === authDID}
                >
                    Decrypt
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={verifyResponse}
                    className="button large bottom"
                    disabled={!response}
                >
                    Verify
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={sendResponse}
                    className="button large bottom"
                    disabled={disableSendResponse}
                >
                    Send Response
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={sendReceipt}
                    className="button large bottom"
                    disabled={disableSendReceipt}
                >
                    Send Receipt
                </Button>
            </Box>

            {authContents && (
                <Box sx={{ mt: 2, overflowX: "auto", overflowY: "visible", WebkitOverflowScrolling: "touch" }}>
                    {authDID && (
                        <Typography
                            className="did-mono"
                            onClick={() => openDIDInJsonViewer(authDID)}
                            sx={{
                                mb: 1,
                                overflowWrap: "anywhere",
                                color: "primary.main",
                                cursor: "pointer",
                                textDecoration: "underline",
                            }}
                        >
                            {authDID}
                        </Typography>
                    )}
                    <JsonDocumentView value={authContents} onResolveDID={openDIDInJsonViewer} />
                </Box>
            )}
        </Box>
    );
}

export default AuthTab;
