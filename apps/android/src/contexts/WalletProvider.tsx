import {
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
import SearchClient from "@mdip/keymaster/search";
import CipherWeb from "@mdip/cipher";
import WalletWeb from "@mdip/keymaster/wallet/web";
import { isEncryptedWallet } from '@mdip/keymaster/wallet/typeGuards'
import type { WalletFile } from '@mdip/keymaster/types'
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import { Alert, AlertColor, Snackbar } from "@mui/material";
import PassphraseModal from "../components/PassphraseModal";
import { takeDeepLink } from '../utils/deepLinkQueue';
import { extractDid } from '../utils/utils';
import {
    DEFAULT_GATEKEEPER_URL,
    DEFAULT_SEARCH_SERVER_URL,
    GATEKEEPER_KEY,
    SEARCH_SERVER_KEY
} from "../components/SettingsTab"
import {
    getSessionPassphrase,
    setSessionPassphrase,
    clearSessionPassphrase,
} from "../utils/sessionPassphrase";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

interface WalletContextValue {
    currentId: string;
    setCurrentId: Dispatch<SetStateAction<string>>;
    validId: boolean;
    setValidId: Dispatch<SetStateAction<boolean>>;
    currentDID: string;
    setCurrentDID: Dispatch<SetStateAction<string>>;
    registry: string;
    setRegistry: Dispatch<SetStateAction<string>>;
    registries: string[];
    setRegistries: Dispatch<SetStateAction<string[]>>;
    idList: string[];
    setIdList: Dispatch<SetStateAction<string[]>>;
    unresolvedIdList: string[];
    setUnresolvedIdList: Dispatch<SetStateAction<string[]>>;
    setError(error: string): void;
    setWarning(warning: string): void;
    setSuccess(message: string): void;
    manifest: Record<string, unknown> | undefined;
    setManifest: Dispatch<SetStateAction<Record<string, unknown> | undefined>>;
    resolveDID: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
    keymaster: Keymaster | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

let search: SearchClient | undefined;

export function WalletProvider({ children }: { children: ReactNode }) {
    const [currentId, setCurrentId] = useState<string>("");
    const [validId, setValidId] = useState<boolean>(false);
    const [currentDID, setCurrentDID] = useState<string>("");
    const [idList, setIdList] = useState<string[]>([]);
    const [unresolvedIdList, setUnresolvedIdList] = useState<string[]>([]);
    const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(undefined);
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [registries, setRegistries] = useState<string[]>([]);
    const [passphraseErrorText, setPassphraseErrorText] = useState<string>("");
    const [modalAction, setModalAction] = useState<string>("");
    const [isReady, setIsReady] = useState<boolean>(false);

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    const setError = (error: any) => {
        const errorMessage = error.error || error.message || String(error);
        setSnackbar({
            open: true,
            message: errorMessage,
            severity: "error",
        });
    };

    const setSuccess = (message: string) => {
        setSnackbar({
            open: true,
            message: message,
            severity: "success",
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

    function openEvent(did: string, type: string) {
        const evt = new CustomEvent(type, { detail: { did } });
        window.dispatchEvent(evt);
    }

    function parseMdip(url: string): { action?: string, did?: string | null } {
        try {
            const u = new URL(url.replace(/^mdip:\/\//, 'https://'));
            const action = (u.hostname || u.pathname.replace(/^\//, '') || '').toLowerCase();
            const did = extractDid(url);
            return { action, did };
        } catch {
            return { did: extractDid(url) };
        }
    }

    useEffect(() => {
        if (!isReady) {
            return;
        }

        const handleQueued = () => {
            const url = takeDeepLink();
            if (!url) {
                return;
            }

            const { action, did } = parseMdip(url);

            if (action === 'accept' && did) {
                openEvent(did, "mdip:openAccept");
                return;
            }

            if (did) {
                openEvent(did, "mdip:openAuth");
            }
        };

        handleQueued();
        window.addEventListener('mdip:deepLinkQueued', handleQueued);
        return () => window.removeEventListener('mdip:deepLinkQueued', handleQueued);
    }, [isReady]);

    const keymasterRef = useRef<Keymaster | null>(null);

    async function initialiseStorage() {
        const gatekeeperUrl = localStorage.getItem(GATEKEEPER_KEY);
        const searchServerUrl = localStorage.getItem(SEARCH_SERVER_KEY);
        if (!gatekeeperUrl) {
            localStorage.setItem(GATEKEEPER_KEY, DEFAULT_GATEKEEPER_URL);
        }
        if (!searchServerUrl) {
            localStorage.setItem(SEARCH_SERVER_KEY, DEFAULT_SEARCH_SERVER_URL);
        }
    }

    async function initialiseWallet() {
        const gatekeeperUrl = localStorage.getItem(GATEKEEPER_KEY);
        const searchServerUrl = localStorage.getItem(SEARCH_SERVER_KEY);

        await gatekeeper.connect({ url: gatekeeperUrl || DEFAULT_GATEKEEPER_URL });
        search = await SearchClient.create({ url: searchServerUrl || DEFAULT_SEARCH_SERVER_URL });

        const wallet = new WalletWeb();
        const walletData = await wallet.loadWallet();

        const pass = getSessionPassphrase();

        if (pass) {
            let res = await decryptWallet(pass);
            if (res) {
                return;
            }
        }

        if (isEncryptedWallet(walletData)) {
            setModalAction("decrypt");
        } else {
            keymasterRef.current = new Keymaster({
                gatekeeper,
                wallet,
                cipher,
                search,
            });

            if (!walletData) {
                await keymasterRef.current.newWallet();
            }

            setModalAction("encrypt");
        }
    }

    useEffect(() => {
        async function init() {
            await initialiseStorage()
            await initialiseWallet();
        }
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function decryptWallet(passphrase: string, modal = false) {
        const wallet_chrome = new WalletWeb();
        const wallet_enc = new WalletWebEncrypted(wallet_chrome, passphrase);
        const wallet_cache = new WalletCache(wallet_enc);

        if (modal && modalAction === "encrypt") {
            const walletData = await wallet_chrome.loadWallet();
            await wallet_enc.saveWallet(walletData as WalletFile, true);
        } else {
            try {
                await wallet_enc.loadWallet();
            } catch (e) {
                if (modal) {
                    setPassphraseErrorText("Incorrect passphrase");
                } else {
                    clearSessionPassphrase();
                }
                return false;
            }
        }

        if (modal) {
            setSessionPassphrase(passphrase);
        }

        keymasterRef.current = new Keymaster({
            gatekeeper,
            wallet: wallet_cache,
            cipher,
            search,
        });

        setIsReady(true);
        setModalAction("");
        setPassphraseErrorText("");

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
            setManifest((docs.didDocumentData as {manifest?: Record<string, unknown>}).manifest);
        } catch (error: any) {
            setError(error);
        }
    }

    const value: WalletContextValue = {
        currentId,
        setCurrentId,
        validId,
        setValidId,
        currentDID,
        setCurrentDID,
        registry,
        setRegistry,
        registries,
        setRegistries,
        idList,
        setIdList,
        unresolvedIdList,
        setUnresolvedIdList,
        manifest,
        setManifest,
        setError,
        setWarning,
        setSuccess,
        resolveDID,
        initialiseWallet,
        keymaster: keymasterRef.current,
    };

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== ""}
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
                sx={{
                    mt: "env(safe-area-inset-top)",
                }}
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
