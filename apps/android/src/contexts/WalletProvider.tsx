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
import { isEncryptedWallet } from '@mdip/keymaster/wallet/typeGuards';
import type { WalletFile } from '@mdip/keymaster/types';
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import { useSnackbar } from "./SnackbarProvider";
import PassphraseModal from "../components/modals/PassphraseModal";
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

type InitIntent = "unlock" | "setup" | "restore";

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
    manifest: Record<string, unknown> | undefined;
    setManifest: Dispatch<SetStateAction<Record<string, unknown> | undefined>>;
    pendingMnemonic: string;
    setPendingMnemonic: Dispatch<SetStateAction<string>>;
    walletAction: "" | "decrypt" | "encrypt" | "restore";
    setWalletAction: Dispatch<SetStateAction<"" | "decrypt" | "encrypt" | "restore">>;
    resolveDID: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
    refreshFlag: number;
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
    const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
    const [walletAction, setWalletAction] = useState<"" | "decrypt" | "encrypt" | "restore">("");
    const [isReady, setIsReady] = useState<boolean>(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);
    const { setError } = useSnackbar();

    const keymasterRef = useRef<Keymaster | null>(null);

    useEffect(() => {
        if (walletAction) {
            setPassphraseErrorText("");
        }
    }, [walletAction]);

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
            let res = await initWithPassphrase(pass, "unlock");
            if (res) {
                return;
            }
            clearSessionPassphrase();
        }

        if (isEncryptedWallet(walletData)) {
            setWalletAction("decrypt");
        } else {
            setWalletAction("encrypt");
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

    async function makeKeymaster(passphrase: string) {
        const walletWeb = new WalletWeb();
        const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
        const walletCache = new WalletCache(walletEnc);

        return new Keymaster({
            gatekeeper,
            wallet: walletCache,
            cipher,
            search,
            passphrase,
        });
    }

    async function initWithPassphrase(passphrase: string, intent: InitIntent) {
        try {
            if (intent === "unlock") {
                const keymaster = await makeKeymaster(passphrase);
                await keymaster.loadWallet();
                keymasterRef.current = keymaster;
            } else if (intent === "setup") {
                const walletPlain = new WalletWeb();
                const kmPlain = new Keymaster({
                    gatekeeper,
                    wallet: walletPlain,
                    cipher,
                    search,
                    passphrase,
                });

                const existing = await walletPlain.loadWallet();
                if (existing) {
                    await kmPlain.loadWallet();
                } else {
                    await kmPlain.newWallet();
                }

                const v1Plain = await walletPlain.loadWallet() as WalletFile;
                const walletEnc = new WalletWebEncrypted(walletPlain, passphrase);
                await walletEnc.saveWallet(v1Plain!, true);
                const walletCache = new WalletCache(walletEnc);

                keymasterRef.current = new Keymaster({
                    gatekeeper,
                    wallet: walletCache,
                    cipher,
                    search,
                    passphrase,
                });
            } else if (intent === "restore") {
                const keymaster = await makeKeymaster(passphrase);
                await keymaster.newWallet(pendingMnemonic, true);
                await keymaster.recoverWallet();
                await keymaster.loadWallet();
                keymasterRef.current = keymaster;
                setPendingMnemonic("");
            }

            setSessionPassphrase(passphrase);

            setIsReady(true);
            setWalletAction("");
            setPassphraseErrorText("");
            if (intent !== "unlock") {
                setRefreshFlag(r => r + 1);
            }
            return true;
        } catch {
            setPassphraseErrorText(
                intent === "unlock" ? "Incorrect passphrase" : "Failed to set/encrypt wallet"
            );
            return false;
        }
    }

    async function handlePassphraseSubmit(passphrase: string) {
        const intent: InitIntent =
            walletAction === "decrypt" ? "unlock" :
                walletAction === "restore" ? "restore" : "setup";

        await initWithPassphrase(passphrase, intent);
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
        pendingMnemonic,
        setPendingMnemonic,
        walletAction,
        setWalletAction,
        resolveDID,
        initialiseWallet,
        refreshFlag,
        keymaster: keymasterRef.current,
    };

    return (
        <>
            <PassphraseModal
                isOpen={walletAction !== ""}
                title={
                    walletAction === "decrypt"
                        ? "Enter Your Wallet Passphrase"
                        : walletAction === "restore"
                            ? "Set a New Passphrase"
                            : "Set Your Wallet Passphrase"
                }
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                encrypt={walletAction !== "decrypt"}
            />

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
