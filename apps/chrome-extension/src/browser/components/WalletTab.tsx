import React, {useState} from "react";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import {
    Box,
    Button,
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useSnackbar } from "../../shared/contexts/SnackbarProvider";
import WarningModal from "../../shared/WarningModal";
import MnemonicModal from "./MnemonicModal";
import { StoredWallet } from '@mdip/keymaster/types';

const WalletTab = () => {
    const [open, setOpen] = useState<boolean>(false);
    const [pendingWallet, setPendingWallet] = useState<StoredWallet | null>(null);
    const [mnemonicString, setMnemonicString] = useState<string>("");
    const [showMnemonicModal, setShowMnemonicModal] = useState<boolean>(false);
    const [pendingRecover, setPendingRecover] = useState<boolean>(false);
    const [checkingWallet, setCheckingWallet] = useState<boolean>(false);
    const [showFixModal, setShowFixModal] = useState<boolean>(false);
    const [checkResultMessage, setCheckResultMessage] = useState<string>("");
    const {
        keymaster,
        initialiseWallet,
        pendingMnemonic,
        setPendingMnemonic,
        setWalletAction,
    } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();

    const handleClickOpen = () => {
        setPendingWallet(null);
        setOpen(true);
    };

    const handleClose = () => {
        setOpen(false);
        setPendingWallet(null);
        setPendingMnemonic("");
        setPendingRecover(false);
    };

    const handleCloseFixModal = () => {
        setShowFixModal(false);
        setCheckResultMessage("");
    };

    async function wipeStoredValues() {
        await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        setMnemonicString("");
        await initialiseWallet();
    }

    async function wipeAndClose() {
        const wallet_chrome = new WalletChrome();
        await chrome.storage.local.remove([wallet_chrome.walletName]);
        await wipeStoredValues();
    }

    async function uploadWallet(wallet: StoredWallet) {
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });

        const wallet_chrome = new WalletChrome();
        await chrome.storage.local.remove([wallet_chrome.walletName]);
        await wallet_chrome.saveWallet(wallet, true);

        setMnemonicString("");
        await initialiseWallet();
    }

    async function restoreFromMnemonic() {
        setWalletAction("restore");
        await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        setMnemonicString("");
    }

    async function checkWallet() {
        if (!keymaster) {
            return;
        }
        setCheckingWallet(true);
        try {
            const { checked, invalid, deleted } = await keymaster.checkWallet();

            if (invalid === 0 && deleted === 0) {
                setSuccess(`${checked} DIDs checked, no problems found`);
            } else {
                const msg =
                    `${checked} DIDs checked.\n` +
                    `${invalid} invalid DIDs found.\n` +
                    `${deleted} deleted DIDs found.\n\n` +
                    `Would you like to fix these?`;
                setCheckResultMessage(msg);
                setShowFixModal(true);
            }
        } catch (error: any) {
            setError(error);
        }
        setCheckingWallet(false);
    }

    async function handleFixWalletConfirm() {
        setShowFixModal(false);
        setCheckResultMessage("");
        if (!keymaster) {
            return;
        }
        try {
            const { idsRemoved, ownedRemoved, heldRemoved, namesRemoved } =
                await keymaster.fixWallet();
            setSuccess(
                `${idsRemoved} IDs removed\n${ownedRemoved} owned DIDs removed\n${heldRemoved} held DIDs removed\n${namesRemoved} names removed`
            );
            await initialiseWallet();
            setMnemonicString("");
        } catch (error: any) {
            setError(error);
        }
    }

    async function recoverWallet() {
        if (!keymaster) {
            return;
        }
        await keymaster.recoverWallet();
        setMnemonicString("");
    }

    const handleConfirm = async () => {
        try {
            if (pendingRecover) {
                await recoverWallet();
            } else if (pendingWallet) {
                await uploadWallet(pendingWallet);
            } else if (pendingMnemonic) {
                await restoreFromMnemonic();
            } else {
                await wipeAndClose();
            }
        } catch (error: any) {
            setError(error);
        }

        setOpen(false);
        setPendingWallet(null);
        setPendingRecover(false);
    };

    async function showMnemonic() {
        if (!keymaster) {
            return;
        }
        try {
            const response = await keymaster.decryptMnemonic();
            setMnemonicString(response);
        } catch (error: any) {
            setError(error);
        }
    }

    async function hideMnemonic() {
        setMnemonicString("");
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

                    const isEncryptedBlob = typeof json?.salt === "string" && typeof json?.iv === "string" && typeof json?.data === "string";
                    const isV1Plain = json?.version === 1 && json?.seed && typeof json.seed?.mnemonicEnc?.data === "string";
                    const isV0Plain = !json?.version && json?.seed?.mnemonic && json?.seed?.hdkey?.xpub && json?.seed?.hdkey?.xpriv;

                    if (!isEncryptedBlob && !isV1Plain && !isV0Plain) {
                        setError("Unsupported wallet file. Upload an encrypted blob, a v1 wallet, or a legacy v0 wallet.");
                        return;
                    }

                    setPendingMnemonic("");
                    setPendingRecover(false);
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

    async function downloadWallet() {
        if (!keymaster) {
            return;
        }
        try {
            const wallet = await keymaster.exportEncryptedWallet();
            const walletJSON = JSON.stringify(wallet, null, 4);
            const blob = new Blob([walletJSON], { type: 'application/json' });
            const url = URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = url;
            link.download = 'mdip-wallet.json';
            link.click();

            URL.revokeObjectURL(url);
        } catch (error: any) {
            setError(error);
        }
    }

    async function handleRecoverWallet() {
        setPendingRecover(true);
        setOpen(true);
    }

    async function importWallet() {
        setShowMnemonicModal(true);
    }

    function handleMnemonicSubmit(mnemonic: string) {
        setShowMnemonicModal(false);
        setPendingMnemonic(mnemonic);
        setPendingWallet(null);
        setOpen(true);
    }

    function handleMnemonicModalClose() {
        setShowMnemonicModal(false);
        setPendingMnemonic("");
    }

    async function backupWallet() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.backupWallet();
            setSuccess("Wallet backup successful");
        } catch (error: any) {
            setError(error);
        }
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

            <WarningModal
                title="Fix Wallet?"
                warningText={checkResultMessage}
                isOpen={showFixModal}
                onClose={handleCloseFixModal}
                onSubmit={handleFixWalletConfirm}
            />

            <MnemonicModal
                isOpen={showMnemonicModal}
                onSubmit={handleMnemonicSubmit}
                onClose={handleMnemonicModalClose}
            />

            <Box className="flex-box" sx={{ gap: 2 }}>
                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleClickOpen}
                >
                    New
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={importWallet}
                >
                    Import
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={backupWallet}
                >
                    Backup
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleRecoverWallet}
                >
                    Recover
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={checkWallet}
                    disabled={checkingWallet}
                >
                    Check
                </Button>
            </Box>
            <Box className="flex-box" sx={{ gap: 2 }}>
                {mnemonicString ? (
                    <Button
                        className="mini-margin"
                        variant="contained"
                        color="primary"
                        onClick={hideMnemonic}
                    >
                        Hide Mnemonic
                    </Button>
                ) : (
                    <Button
                        className="mini-margin"
                        variant="contained"
                        color="primary"
                        onClick={showMnemonic}
                    >
                        Show Mnemonic
                    </Button>
                )}

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={downloadWallet}
                >
                    Download
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleUploadClick}
                >
                    Upload
                </Button>
            </Box>
            <Box>
                <pre>{mnemonicString}</pre>
            </Box>
        </Box>
    );
};

export default WalletTab;
