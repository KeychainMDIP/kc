import React, {
    createContext,
    Dispatch,
    ReactNode,
    SetStateAction,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

import GatekeeperClient from "@mdip/gatekeeper/client";
import Keymaster from "@mdip/keymaster";
import CipherWeb from "@mdip/cipher/web";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import { Alert, AlertColor, Snackbar } from "@mui/material";
import PassphraseModal from "../PassphraseModal";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

interface WalletContextValue {
    currentId: string;
    setCurrentId: (value: string) => Promise<void>;
    currentDID: string;
    setCurrentDID: Dispatch<SetStateAction<string>>;
    selectedId: string;
    setSelectedId: Dispatch<SetStateAction<string>>;
    registry: string;
    setRegistry: (value: string) => Promise<void>;
    registries: string[];
    setRegistries: Dispatch<SetStateAction<string[]>>;
    idList: string[];
    setIdList: Dispatch<SetStateAction<string[]>>;
    setError(error: string): void;
    setWarning(warning: string): void;
    manifest: any;
    setManifest: Dispatch<SetStateAction<any>>;
    resolveDID: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
    openJSONViewer: (title: string, did: string, contents?: any) => void;
    handleCopyDID: (did: string) => void;
    storeState: (key: string, value: string | boolean) => Promise<void>;
    refreshWalletStored: (state: any) => Promise<void>;
    resetWalletState: () => void;
    refreshFlag: number;
    keymaster: Keymaster | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children, isBrowser }: { children: ReactNode, isBrowser: boolean }) {
    const [currentId, setCurrentIdState] = useState<string>("");
    const [currentDID, setCurrentDID] = useState<string>("");
    const [idList, setIdList] = useState<string[]>([]);
    const [manifest, setManifest] = useState(null);
    const [registry, setRegistryState] = useState<string>("hyperswarm");
    const [registries, setRegistries] = useState<string[]>([]);
    const [selectedId, setSelectedId] = useState<string>("");
    const [passphraseErrorText, setPassphraseErrorText] = useState(null);
    const [modalAction, setModalAction] = useState(null);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);

    async function storeState(key: string, value: string | boolean) {
        if (isBrowser) {
            return;
        }
        await chrome.runtime.sendMessage({
            action: "STORE_STATE",
            key,
            value,
        });
    }

    function resetWalletState() {
        setCurrentIdState("");
        setRegistryState("hyperswarm");
    }

    async function setCurrentId(value: string) {
        setCurrentIdState(value);
        await storeState("currentId", value);
    }

    async function setRegistry(value: string) {
        setRegistryState(value);
        await storeState("registry", value);
    }

    async function refreshWalletStored(state: any) {
        if (state.registry) {
            setRegistryState(state.registry);
        }
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

    const setWarning = (warning: string) => {
        setSnackbar({
            open: true,
            message: warning,
            severity: "warning",
        });
    };

    const handleSnackbarClose = () => {
        setSnackbar((prev) => ({ ...prev, open: false }));
    };

    const keymasterRef = useRef<Keymaster | null>(null);

    async function initialiseWallet() {
        const { gatekeeperUrl } = await chrome.storage.sync.get([
            "gatekeeperUrl",
        ]);
        await gatekeeper.connect({ url: gatekeeperUrl });

        const wallet = new WalletChrome();
        const walletData = await wallet.loadWallet();

        let pass: string;
        let response = await chrome.runtime.sendMessage({
            action: "GET_PASSPHRASE",
        });
        if (response && response.passphrase) {
            pass = response.passphrase;
        }

        if (pass) {
            let res = await decryptWallet(pass);
            if (res) {
                return;
            }
        }

        if (walletData && walletData.salt && walletData.iv && walletData.data) {
            setModalAction("decrypt");
        } else {
            keymasterRef.current = new Keymaster({
                gatekeeper,
                wallet,
                cipher,
            });

            if (!walletData) {
                await keymasterRef.current.newWallet();
            }

            setModalAction("encrypt");
        }
    }

    useEffect(() => {
        initialiseWallet();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function clearStoredPassphrase() {
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
    }

    async function decryptWallet(passphrase: string, modal: boolean = false) {
        const wallet_chrome = new WalletChrome();
        const wallet_enc = new WalletWebEncrypted(wallet_chrome, passphrase);
        const wallet_cache = new WalletCache(wallet_enc);

        if (modal && modalAction === "encrypt") {
            const walletData = await wallet_chrome.loadWallet();
            await wallet_enc.saveWallet(walletData, true);
        } else {
            try {
                await wallet_enc.loadWallet();
            } catch (e) {
                if (modal) {
                    setPassphraseErrorText("Incorrect passphrase");
                } else {
                    await clearStoredPassphrase();
                }
                return false;
            }
        }

        if (modal) {
            await chrome.runtime.sendMessage({
                action: "STORE_PASSPHRASE",
                passphrase,
            });
        }

        keymasterRef.current = new Keymaster({
            gatekeeper,
            wallet: wallet_cache,
            cipher,
        });

        setIsReady(true);
        setModalAction(null);
        setPassphraseErrorText(null);
        setRefreshFlag(r => r + 1);

        return true;
    }

    async function handlePassphraseSubmit(passphrase: string) {
        await decryptWallet(passphrase, true);
    }

    async function resolveDID() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const id = await keymaster.fetchIdInfo();
            const docs = await keymaster.resolveDID(id.did);
            setManifest(docs.didDocumentData.manifest);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    function openJSONViewer(title: string, did: string, contents?: any) {
        const titleEncoded = encodeURIComponent(title);
        const didEncoded = encodeURIComponent(did);
        let viewerUrl = `chrome-extension://${chrome.runtime.id}/viewer.html?title=${titleEncoded}&did=${didEncoded}`;

        if (contents) {
            const contentsString = JSON.stringify(contents, null, 4);
            const jsonEncoded = encodeURIComponent(contentsString);
            viewerUrl += `&json=${jsonEncoded}`;
        }

        window.open(viewerUrl, "_blank");
    }

    function handleCopyDID(did: string) {
        navigator.clipboard.writeText(did).catch((err) => {
            setError(err.message || String(err));
        });
    }

    const value: WalletContextValue = {
        currentId,
        setCurrentId,
        currentDID,
        setCurrentDID,
        selectedId,
        setSelectedId,
        registry,
        setRegistry,
        registries,
        setRegistries,
        idList,
        setIdList,
        manifest,
        setManifest,
        setError,
        setWarning,
        resolveDID,
        initialiseWallet,
        openJSONViewer,
        handleCopyDID,
        storeState,
        resetWalletState,
        refreshWalletStored,
        refreshFlag,
        keymaster: keymasterRef.current,
    };

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null}
                title={
                    modalAction === "decrypt"
                        ? "Enter Your Wallet Passphrase"
                        : "Set Your Wallet Passphrase"
                }
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                encrypt={modalAction === "encrypt"}
            />

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

            {isReady && (
                <WalletContext.Provider value={value}>
                    {children}
                </WalletContext.Provider>
            )}
        </>
    );
}

export function useWalletContext() {
    const context = useContext(WalletContext);
    if (!context) {
        throw new Error("Failed to get context from WalletContext.Provider");
    }
    return context;
}
