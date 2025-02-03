import React from "react";
import { Box, Button, TextField } from "@mui/material";
import axios from "axios";
import { useUIContext } from "../../shared/UIContext";

function AuthTab() {
    const {
        authDID,
        challenge,
        keymaster,
        openJSONViewer,
        setChallenge,
        setAuthDID,
        setError,
        setWarning,
        response,
        setResponse,
        callback,
        setCallback,
        disableSendResponse,
        setDisableSendResponse,
    } = useUIContext();

    async function newChallenge() {
        try {
            const challenge = await keymaster.createChallenge();
            await setChallenge(challenge);
            await resolveChallenge(challenge);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function resolveChallenge(did: string) {
        try {
            const asset = await keymaster.resolveAsset(did);
            await setAuthDID(did);
            openJSONViewer("Resolve Challenge", did, asset);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function createResponse() {
        try {
            await clearResponse();
            const response = await keymaster.createResponse(challenge, {
                retries: 10,
            });
            await setResponse(response);

            const asset = await keymaster.resolveAsset(challenge);
            const callback = asset.challenge.callback;

            await setCallback(callback);

            if (callback) {
                await setDisableSendResponse(false);
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function clearChallenge() {
        await setChallenge("");
    }

    async function decryptResponse(did: string) {
        try {
            const decrypted = await keymaster.decryptJSON(did);
            await setAuthDID(did);
            openJSONViewer("Decrypt Response", did, decrypted);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function verifyResponse() {
        try {
            const verify = await keymaster.verifyResponse(response);

            if (verify.match) {
                setWarning("Response is VALID");
            } else {
                setWarning("Response is NOT VALID");
            }
        } catch (error) {
            console.error(error);
            setError(error.error || error.message || String(error));
        }
    }

    async function clearResponse() {
        await setResponse("");
    }

    async function sendResponse() {
        try {
            await setDisableSendResponse(true);
            await axios.post(callback, { response });
            await setCallback(null);
        } catch (error) {
            setError(error.error || error.message || String(error));
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
                    disabled={!challenge}
                >
                    Clear
                </Button>
            </Box>

            <Box className="flex-box mt-2">
                <TextField
                    label="Response"
                    variant="outlined"
                    value={response}
                    onChange={(e) => setResponse(e.target.value.trim())}
                    size="small"
                    className="text-field top"
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
                    Send
                </Button>

                <Button
                    variant="contained"
                    color="primary"
                    onClick={clearResponse}
                    className="button large bottom"
                    disabled={!response}
                >
                    Clear
                </Button>
            </Box>
        </Box>
    );
}

export default AuthTab;
