import React from "react";
import { Box, Button, InputAdornment, MenuItem, Select, TextField } from "@mui/material";
import axios from "axios";
import type { Challenge } from "@mdip/keymaster/types";
import { useWalletContext } from "../contexts/WalletProvider";
import { useAuthContext } from "../contexts/AuthContext";
import { useUIContext } from "../contexts/UIContext";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";

function AuthTab() {
    const { keymaster } = useWalletContext();
    const { setError, setSuccess, setWarning } = useSnackbar();
    const {
        authDID,
        challenge,
        setChallenge,
        setAuthDID,
        response,
        setResponse,
        callback,
        setCallback,
        disableSendResponse,
        setDisableSendResponse,
    } = useAuthContext();
    const {
        agentList,
        schemaList,
    } = useVariablesContext();
    const { openBrowserWindow } = useUIContext();
    const [challengeSchema, setChallengeSchema] = React.useState<string>("");
    const [challengeAttester, setChallengeAttester] = React.useState<string>("");
    const [disableSendReceipt, setDisableSendReceipt] = React.useState<boolean>(true);

    React.useEffect(() => {
        if (challengeSchema && !schemaList.includes(challengeSchema)) {
            setChallengeSchema("");
            setChallengeAttester("");
        }
    }, [challengeSchema, schemaList]);

    React.useEffect(() => {
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
            await setAuthDID(did);
            openBrowserWindow({ title: "Resolve Challenge", did, contents });
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
            await setAuthDID(did);
            openBrowserWindow({ title: "Decrypt Response", did, contents });
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
            await setAuthDID(response);
            openBrowserWindow({
                title: "Challenge Receipts",
                did: response,
                contents: { receiptDIDs },
            });

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
                            maxLength: 85,
                        },
                    }}
                />
            </Box>

            <Box className="flex-box">
                <Select
                    value={challengeSchema}
                    onChange={(event) => {
                        setChallengeSchema(event.target.value);
                        if (!event.target.value) {
                            setChallengeAttester("");
                        }
                    }}
                    displayEmpty
                    variant="outlined"
                    size="small"
                    className="select-small-left"
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        "& .MuiOutlinedInput-notchedOutline": {
                            borderRadius: 0,
                        },
                    }}
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
                    displayEmpty
                    disabled={!challengeSchema}
                    variant="outlined"
                    size="small"
                    className="select-small"
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        "& .MuiOutlinedInput-notchedOutline": {
                            borderRadius: 0,
                        },
                    }}
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
                            maxLength: 85,
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
                        },
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
                    Response
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={sendReceipt}
                    className="button large bottom"
                    disabled={disableSendReceipt}
                >
                    Receipt
                </Button>
            </Box>
        </Box>
    );
}

export default AuthTab;
