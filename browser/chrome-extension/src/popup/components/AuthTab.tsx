import React, { useState } from "react";
import { Box, Button, TextField } from "@mui/material";
import axios from "axios";
import { usePopupContext } from "../PopupContext";

function AuthTab() {
    const { keymaster, openBrowserTab, setError, setWarning } =
        usePopupContext();
    const [authDID, setAuthDID] = useState("");
    const [callback, setCallback] = useState(null);
    const [challenge, setChallenge] = useState("");
    const [disableSendResponse, setDisableSendResponse] = useState(true);
    const [response, setResponse] = useState("");

    async function newChallenge() {
        try {
            const challenge = await keymaster.createChallenge();
            setChallenge(challenge);
            await resolveChallenge(challenge);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function resolveChallenge(did: string) {
        try {
            const asset = await keymaster.resolveAsset(did);
            setAuthDID(did);
            openBrowserTab(
                "Resolve Challenge",
                did,
                JSON.stringify(asset, null, 4),
            );
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
            setResponse(response);

            const asset = await keymaster.resolveAsset(challenge);
            const callback = asset.challenge.callback;

            setCallback(callback);

            if (callback) {
                setDisableSendResponse(false);
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function clearChallenge() {
        setChallenge("");
    }

    async function decryptResponse(did: string) {
        try {
            const decrypted = await keymaster.decryptJSON(did);
            setAuthDID(did);
            openBrowserTab(
                "Decrypt Response",
                did,
                JSON.stringify(decrypted, null, 4),
            );
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
        setResponse("");
    }

    async function sendResponse() {
        try {
            setDisableSendResponse(true);
            await axios.post(callback, { response });
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
