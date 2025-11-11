import React, { useState } from "react";
import {
    Box,
    Button,
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useSnackbar } from "../../shared/contexts/SnackbarProvider";
import WarningModal from "../../shared/WarningModal";
import MnemonicModal from "../../shared/MnemonicModal";
import WalletChrome from "@mdip/keymaster/wallet/chrome";

const WalletTab = () => {
    const [open, setOpen] = useState<boolean>(false);
    const [mnemonicString, setMnemonicString] = useState<string>("");
    const [showMnemonicModal, setShowMnemonicModal] = useState<boolean>(false);
    const [pendingRecover, setPendingRecover] = useState<boolean>(false);
    const [checkingWallet, setCheckingWallet] = useState<boolean>(false);
    const [showFixModal, setShowFixModal] = useState<boolean>(false);
    const [checkResultMessage, setCheckResultMessage] = useState<string>("");
    const {
        keymaster,
        initialiseWallet,
        handleWalletUploadFile,
        pendingMnemonic,
        setPendingMnemonic,
        pendingWallet,
        setPendingWallet,
    } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();

    const handleClickOpen = () => {
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

    async function createNewWallet() {
        const chromeWallet = new WalletChrome();
        await chrome.storage.local.remove([chromeWallet.walletName]);
        await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE"});
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE"});
        await initialiseWallet();
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
        } catch (error: any) {
            setError(error);
        }
    }

    async function recoverWallet() {
        if (!keymaster) {
            return;
        }
        await keymaster.recoverWallet();
        await initialiseWallet();
    }

    const handleConfirm = async () => {
        try {
            if (pendingRecover) {
                await recoverWallet();
            } else if (pendingMnemonic) {
                await initialiseWallet();
            } else if (pendingWallet) {
                await handleWalletUploadFile(pendingWallet);
            } else {
                await createNewWallet();
            }
        } catch (error: any) {
            setError(error);
        }

        setOpen(false);
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
            if (!file) {
                return;
            }

            const text = await file.text();

            try {
                const wallet = JSON.parse(text);
                setPendingWallet(wallet);
                setOpen(true);
            } catch (err) {
                setError("Invalid JSON file.");
            }
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

            {mnemonicString && (
                <Box
                    component="pre"
                    sx={{
                        m: 0,
                        px: 2,
                        whiteSpace: "pre-wrap",
                        fontFamily: "inherit",
                    }}
                >
                    {mnemonicString}
                </Box>
            )}
        </Box>
    );
};

export default WalletTab;
