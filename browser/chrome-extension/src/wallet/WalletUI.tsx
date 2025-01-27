import React, { useState } from "react";
import {
    Alert,
    AlertColor,
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Snackbar,
    Typography,
} from "@mui/material";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import Keymaster from "@mdip/keymaster";
import GatekeeperClient from "@mdip/gatekeeper/client";
import CipherWeb from "@mdip/cipher/web";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

const WalletUI = () => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [pendingWallet, setPendingWallet] = useState<any>(null);
    const [mnemonicString, setMnemonicString] = useState("");
    const [walletString, setWalletString] = useState("");

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    const handleClickOpen = () => {
        if (!loading) {
            setPendingWallet(null);
            setOpen(true);
        }
    };

    const handleClose = () => {
        setOpen(false);
        setPendingWallet(null);
    };

    const deleteValues = [
        "selectedTab",
        "currentId",
        "registry",
        "heldDID",
        "authDID",
        "callback",
        "response",
        "disableSendResponse",
    ];

    const setError = (error: string) => {
        setSnackbar({
            open: true,
            message: error,
            severity: "error",
        });
    };

    async function wipeStoredValues() {
        await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        window.close();
    }

    async function wipeAndClose() {
        const wallet_chrome = new WalletChrome();
        await chrome.storage.local.remove([wallet_chrome.walletName]);
        await wipeStoredValues();
    }

    async function uploadWallet(wallet: any) {
        const wallet_chrome = new WalletChrome();
        await wallet_chrome.saveWallet(wallet, true);
        await wipeStoredValues();
    }

    const handleConfirm = async () => {
        setLoading(true);
        try {
            if (pendingWallet) {
                await uploadWallet(pendingWallet);
            } else {
                await wipeAndClose();
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
        }

        setOpen(false);
        setLoading(false);
        setPendingWallet(null);
    };

    async function showMnemonic() {
        try {
            const keymaster = await getKeymaster();
            const response = await keymaster.decryptMnemonic();
            setMnemonicString(response);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function hideMnemonic() {
        setMnemonicString("");
    }

    async function getKeymaster() {
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

        try {
            await wallet_enc.loadWallet();
        } catch (e) {
            setError("Invalid passphrase.");
            return;
        }

        return new Keymaster({
            gatekeeper,
            wallet: wallet_enc,
            cipher,
        });
    }

    async function showWallet() {
        try {
            const keymaster = await getKeymaster();
            const wallet = await keymaster.loadWallet();
            setWalletString(JSON.stringify(wallet, null, 4));
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function hideWallet() {
        setWalletString("");
    }

    async function handleUploadClick() {
        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".json,application/json";

        fileInput.onchange = async (event: any) => {
            const file = event.target.files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const contents = e.target?.result as string;
                    const json = JSON.parse(contents);
                    const isUnencrypted =
                        "seed" in json && "counter" in json && "ids" in json;
                    const isEncrypted =
                        "salt" in json && "iv" in json && "data" in json;

                    if (!isUnencrypted && !isEncrypted) {
                        setError(
                            "Invalid wallet JSON. Missing required fields.",
                        );
                        return;
                    }

                    setPendingWallet(json);
                    setOpen(true);
                } catch (err) {
                    setError("Invalid JSON file.");
                }
            };
            reader.onerror = () => {
                setError("Could not read the wallet file.");
            };

            reader.readAsText(file);
        };

        fileInput.click();
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

            <Dialog
                open={open}
                onClose={handleClose}
                disableEnforceFocus
                disableAutoFocus
                disableScrollLock
            >
                <DialogTitle id="confirm-dialog-title">
                    {"Overwrite Wallet?"}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText id="confirm-dialog-description">
                        Are you sure you want to overwrite your existing wallet?
                        This action will close this tab.
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={handleClose}
                        color="primary"
                        disabled={loading}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        color="primary"
                        disabled={loading}
                        autoFocus
                    >
                        Confirm
                    </Button>
                </DialogActions>
            </Dialog>

            <Typography variant="h4" gutterBottom>
                Wallet
            </Typography>

            <Box className="flex-box" sx={{ gap: 2 }}>
                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleClickOpen}
                    sx={{ mr: 2 }}
                >
                    New
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={showWallet}
                    sx={{ mr: 2 }}
                >
                    Show
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleUploadClick}
                    sx={{ mr: 2 }}
                >
                    Upload
                </Button>

                {walletString ? (
                    <Button
                        className="mini-margin"
                        variant="contained"
                        color="primary"
                        onClick={hideWallet}
                        sx={{ mr: 2 }}
                    >
                        Hide Wallet
                    </Button>
                ) : (
                    <Button
                        className="mini-margin"
                        variant="contained"
                        color="primary"
                        onClick={showWallet}
                        sx={{ mr: 2 }}
                    >
                        Show Wallet
                    </Button>
                )}

                {mnemonicString ? (
                    <Button
                        className="mini-margin"
                        variant="contained"
                        color="primary"
                        onClick={hideMnemonic}
                        sx={{ mr: 2 }}
                    >
                        Hide Mnemonic
                    </Button>
                ) : (
                    <Button
                        className="mini-margin"
                        variant="contained"
                        color="primary"
                        onClick={showMnemonic}
                        sx={{ mr: 2 }}
                    >
                        Show Mnemonic
                    </Button>
                )}
            </Box>
            <Box>
                <pre>{mnemonicString}</pre>
            </Box>
            <Box>
                {walletString && (
                    <textarea
                        value={walletString}
                        readOnly
                        style={{
                            width: "800px",
                            height: "600px",
                            overflow: "auto",
                        }}
                    />
                )}
            </Box>
        </Box>
    );
};

export default WalletUI;
