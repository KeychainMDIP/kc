import React, { useState } from "react";
import JsonView from "@uiw/react-json-view";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import {
    Box,
    Button,
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import WarningModal from "../../shared/WarningModal";

const WalletTab = () => {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [pendingWallet, setPendingWallet] = useState<any>(null);
    const [mnemonicString, setMnemonicString] = useState<string>("");
    const [walletObject, setWalletObject] = useState<any>(null);
    const { setError, keymaster, initialiseWallet } = useWalletContext();
    const { wipAllStates } = useUIContext();

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

    async function wipeStoredValues() {
        await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        await initialiseWallet();
        wipAllStates();
        setWalletObject(null);
        setMnemonicString("");
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
            const response = await keymaster.decryptMnemonic();
            setMnemonicString(response);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function hideMnemonic() {
        setMnemonicString("");
    }

    async function showWallet() {
        try {
            const wallet = await keymaster.loadWallet();
            setWalletObject(wallet);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function hideWallet() {
        setWalletObject(null);
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

    return (
        <Box>
            <WarningModal
                title="Overwrite wallet"
                warningText="Are you sure you want to overwrite your existing wallet?"
                isOpen={open}
                onClose={handleClose}
                onSubmit={handleConfirm}
            />

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
                    onClick={handleUploadClick}
                    sx={{ mr: 2 }}
                >
                    Upload
                </Button>

                {walletObject ? (
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
                {walletObject && (
                    <JsonView value={walletObject} shortenTextAfterLength={0} />
                )}
            </Box>
        </Box>
    );
};

export default WalletTab;
