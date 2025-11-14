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
import { useSnackbar } from "./SnackbarProvider";
import PassphraseModal from "../modals/PassphraseModal";
import {
    DEFAULT_GATEKEEPER_URL,
    DEFAULT_SEARCH_SERVER_URL,
    GATEKEEPER_KEY,
    SEARCH_SERVER_KEY,
    WALLET_NAME
} from "../constants";
import {
    getSessionPassphrase,
    setSessionPassphrase,
    clearSessionPassphrase,
} from "../utils/sessionPassphrase";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();


interface WalletContextValue {
    manifest: Record<string, unknown> | undefined;
    setManifest: Dispatch<SetStateAction<Record<string, unknown> | undefined>>;
    registry: string;
    setRegistry: Dispatch<SetStateAction<string>>;
    resolveDID: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
    keymaster: Keymaster | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

let search: SearchClient | undefined;

export function WalletProvider({ children }: { children: ReactNode }) {
    const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(undefined);
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [passphraseErrorText, setPassphraseErrorText] = useState<string>("");
    const [modalAction, setModalAction] = useState<string>("");
    const [isReady, setIsReady] = useState<boolean>(false);
    const { setError } = useSnackbar();

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

        const wallet = new WalletWeb(WALLET_NAME);
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
        const wallet_web = new WalletWeb(WALLET_NAME);
        const wallet_enc = new WalletWebEncrypted(wallet_web, passphrase);
        const wallet_cache = new WalletCache(wallet_enc);

        if (modal && modalAction === "encrypt") {
            const walletData = await wallet_web.loadWallet();
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
        registry,
        setRegistry,
        manifest,
        setManifest,
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
