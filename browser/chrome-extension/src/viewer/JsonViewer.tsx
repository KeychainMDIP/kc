import React, { useEffect, useRef, useState } from "react";
import JsonView from "@uiw/react-json-view";
import {
    Alert,
    AlertColor,
    Box,
    Button,
    MenuItem,
    Select,
    Snackbar,
    Typography,
} from "@mui/material";
import Keymaster from "@mdip/keymaster";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import GatekeeperClient from "@mdip/gatekeeper/client";
import CipherWeb from "@mdip/cipher/web";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

function JsonViewer() {
    const keymaster = useRef<Keymaster | null>(null);
    const [data, setData] = useState<any>(null);
    const [title, setTitle] = useState<any>(null);
    const [selectedDID, setSelectedDID] = useState("");
    const [aliasDocs, setAliasDocs] = useState<any>(null);
    const [aliasDocsVersion, setAliasDocsVersion] = useState(1);
    const [aliasDocsVersionMax, setAliasDocsVersionMax] = useState(1);
    const [aliasDocsVersions, setAliasDocsVersions] = useState([]);

    useEffect(() => {
        const init = async () => {
            const { gatekeeperUrl } = await chrome.storage.sync.get([
                "gatekeeperUrl",
            ]);
            await gatekeeper.connect({ url: gatekeeperUrl });

            let pass: string;
            let response = await chrome.runtime.sendMessage({
                action: "GET_PASSPHRASE",
            });
            if (response && response.passphrase) {
                pass = response.passphrase;
            } else {
                setError("Unable to get passphrase.");
                return;
            }

            const wallet_chrome = new WalletChrome();
            const wallet_enc = new WalletWebEncrypted(wallet_chrome, pass);
            const wallet_cache = new WalletCache(wallet_enc);

            try {
                await wallet_cache.loadWallet();
            } catch (e) {
                setError("Invalid passphrase.");
                return;
            }

            keymaster.current = new Keymaster({
                gatekeeper,
                wallet: wallet_cache,
                cipher,
            });

            await populateData();
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    interface SnackbarState {
        open: boolean;
        message: string;
        severity: AlertColor;
    }

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    const setError = (error: string) => {
        setSnackbar({
            open: true,
            message: error,
            severity: "error",
        });
    };

    async function populateData() {
        const params = new URLSearchParams(window.location.search);
        const paramsTitle = params.get("title") || "";
        const rawJson = params.get("json") || "";
        const did = params.get("did") || "";

        setTitle(paramsTitle);
        setSelectedDID(did);

        try {
            if (rawJson) {
                const parsed = JSON.parse(rawJson);
                setData(parsed);
            } else {
                await resolveDID(did);
            }
        } catch {
            setData({ error: "Failed to populate data JSON" });
        }
    }

    async function resolveDID(did: string) {
        if (!keymaster.current) {
            setError("Keymaster not initialized.");
            return;
        }

        try {
            const docs = await keymaster.current.resolveDID(did);
            setAliasDocs(docs);

            const versions = docs.didDocumentMetadata.version;
            setAliasDocsVersion(versions);
            setAliasDocsVersionMax(versions);
            setAliasDocsVersions(
                Array.from({ length: versions }, (_, i) => i + 1),
            );
        } catch (e) {
            setAliasDocs({ error: "Failed to populate JSON" });
        }
    }

    async function selectAliasDocsVersion(version: number) {
        try {
            setAliasDocsVersion(version);
            const docs = await keymaster.current.resolveDID(selectedDID, {
                atVersion: version,
            });
            setAliasDocs(docs);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    const handleSnackbarClose = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    return (
        <Box>
            <Snackbar
                open={snackbar.open}
                autoHideDuration={5000}
                onClose={handleSnackbarClose}
                anchorOrigin={{ vertical: "top", horizontal: "center" }}
            >
                <Alert
                    onClose={handleSnackbarClose}
                    severity={snackbar.severity}
                    sx={{ width: "100%" }}
                >
                    {snackbar.message}
                </Alert>
            </Snackbar>

            <Typography variant="h5" component="h5">
                {title}
            </Typography>
            {selectedDID && (
                <Typography sx={{ fontFamily: "Courier, monospace" }}>
                    {selectedDID}
                </Typography>
            )}
            {data && <JsonView value={data} shortenTextAfterLength={0} />}
            {aliasDocs && (
                <Box>
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() => selectAliasDocsVersion(1)}
                            disabled={aliasDocsVersion === 1}
                            sx={{
                                height: 40,
                                borderTopRightRadius: 0,
                                borderBottomRightRadius: 0,
                            }}
                        >
                            First
                        </Button>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() =>
                                selectAliasDocsVersion(aliasDocsVersion - 1)
                            }
                            disabled={aliasDocsVersion === 1}
                            sx={{
                                height: 40,
                                borderRadius: 0,
                            }}
                        >
                            Prev
                        </Button>
                        <Select
                            style={{ width: "150px", height: "40px" }}
                            value={aliasDocsVersion}
                            fullWidth
                            onChange={(event) =>
                                selectAliasDocsVersion(
                                    event.target.value as number,
                                )
                            }
                            sx={{
                                height: 40,
                                borderRadius: 0,
                                "& .MuiOutlinedInput-root": {
                                    borderRadius: 0,
                                },
                            }}
                        >
                            {aliasDocsVersions.map((version, index) => (
                                <MenuItem value={version} key={index}>
                                    version {version}
                                </MenuItem>
                            ))}
                        </Select>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() =>
                                selectAliasDocsVersion(aliasDocsVersion + 1)
                            }
                            disabled={aliasDocsVersion === aliasDocsVersionMax}
                            sx={{
                                height: 40,
                                borderRadius: 0,
                            }}
                        >
                            Next
                        </Button>
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={() =>
                                selectAliasDocsVersion(aliasDocsVersionMax)
                            }
                            disabled={aliasDocsVersion === aliasDocsVersionMax}
                            sx={{
                                height: 40,
                                borderTopLeftRadius: 0,
                                borderBottomLeftRadius: 0,
                            }}
                        >
                            Last
                        </Button>
                    </Box>
                    <Box sx={{ mt: 2 }}>
                        <JsonView
                            value={aliasDocs}
                            shortenTextAfterLength={0}
                        />
                    </Box>
                </Box>
            )}
        </Box>
    );
}

export default JsonViewer;
