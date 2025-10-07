import React, { useEffect, useState } from "react";
import JsonViewer from "./JsonViewer";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import {
    Box,
    Button,
} from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { useSnackbar } from "../../shared/contexts/SnackbarProvider";
import WarningModal from "../../shared/WarningModal";
import MnemonicModal from "./MnemonicModal";
import Keymaster from "@mdip/keymaster";
import GatekeeperClient from "@mdip/gatekeeper/client";
import CipherWeb from "@mdip/cipher/web";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

const WalletTab = () => {
    const [open, setOpen] = useState<boolean>(false);
    const [pendingWallet, setPendingWallet] = useState<any>(null);
    const [mnemonicString, setMnemonicString] = useState<string>("");
    const [jsonViewerOpen, setJsonViewerOpen] = useState<boolean>(false);
    const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
    const [showMnemonicModal, setShowMnemonicModal] = useState<boolean>(false);
    const [pendingRecover, setPendingRecover] = useState<boolean>(false);
    const [checkingWallet, setCheckingWallet] = useState<boolean>(false);
    const [showFixModal, setShowFixModal] = useState<boolean>(false);
    const [checkResultMessage, setCheckResultMessage] = useState<string>("");
    const { keymaster, initialiseWallet } = useWalletContext();
    const { setOpenBrowser } = useUIContext();
    const { setError, setSuccess } = useSnackbar();

    const storageKey = "jsonViewerState-wallet-noSubTab";

    useEffect(() => {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) {
            setJsonViewerOpen(true);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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

    function clearJsonWallet() {
        setJsonViewerOpen(false);
        if (setOpenBrowser) {
            setOpenBrowser({
                title: "",
                did: "",
                tab: "wallet",
            });
        }
    }

    const handleCloseFixModal = () => {
        setShowFixModal(false);
        setCheckResultMessage("");
    };

    async function wipeStoredValues() {
        await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        await initialiseWallet();
        clearJsonWallet();
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

    async function getUnencryptedKeymaster() {
        const { gatekeeperUrl } = await chrome.storage.sync.get([
            "gatekeeperUrl",
        ]);
        await gatekeeper.connect({ url: gatekeeperUrl });

        // Avoid using existing passphrase by using unencrypted keymaster
        const wallet = new WalletChrome();
        return new Keymaster({
            gatekeeper,
            wallet,
            cipher,
        });
    }

    async function restoreFromMnemonic() {
        const localKeymaster = await getUnencryptedKeymaster();
        await localKeymaster.newWallet(pendingMnemonic, true);
        await localKeymaster.recoverWallet();
        await wipeStoredValues();
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
            clearJsonWallet();
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
        await initialiseWallet();
        clearJsonWallet();
        setMnemonicString("");
    }

    const handleConfirm = async () => {
        try {
            if (pendingRecover) {
                await recoverWallet();
            } else if (pendingMnemonic) {
                await restoreFromMnemonic();
            } else if (pendingWallet) {
                await uploadWallet(pendingWallet);
            } else {
                await wipeAndClose();
            }
        } catch (error: any) {
            setError(error);
        }

        setOpen(false);
        setPendingMnemonic("");
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

    async function showWallet() {
        if (!keymaster) {
            return;
        }
        try {
            const wallet = await keymaster.loadWallet();
            setJsonViewerOpen(true);
            if (setOpenBrowser) {
                setOpenBrowser({
                    title: "",
                    did: "",
                    tab: "wallet",
                    contents: wallet,
                });
            }
        } catch (error: any) {
            setError(error);
        }
    }

    async function hideWallet() {
        clearJsonWallet();
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

    async function downloadWallet() {
        if (!keymaster) {
            return;
        }
        try {
            const wallet = await keymaster.loadWallet();
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
                    sx={{ mr: 2 }}
                >
                    New
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={importWallet}
                    sx={{ mr: 2 }}
                >
                    Import
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={backupWallet}
                    sx={{ mr: 2 }}
                >
                    Backup
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={handleRecoverWallet}
                    sx={{ mr: 2 }}
                >
                    Recover
                </Button>

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={checkWallet}
                    sx={{ mr: 2 }}
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

                {jsonViewerOpen ? (
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

                <Button
                    className="mini-margin"
                    variant="contained"
                    color="primary"
                    onClick={downloadWallet}
                    sx={{ mr: 2 }}
                >
                    Download
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
            </Box>
            <Box>
                <pre>{mnemonicString}</pre>
            </Box>
            <Box>
                <JsonViewer browserTab="wallet" />
            </Box>
        </Box>
    );
};

export default WalletTab;
