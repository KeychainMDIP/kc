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
import OnboardingModal from "../modals/OnboardingModal";
import MnemonicModal from "../modals/MnemonicModal";
import {useSnackbar} from "./SnackbarProvider";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface WalletContextValue {
    manifest: Record<string, unknown> | undefined;
    setManifest: Dispatch<SetStateAction<Record<string, unknown> | undefined>>;
    registry: string;
    setRegistry: Dispatch<SetStateAction<string>>;
    wipeWallet: () => void;
    restoreMnemonic: (mnemonic: string) => Promise<void>;
    initialiseWallet: () => Promise<void>;
    keymaster: Keymaster | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

let search: SearchClient | undefined;

export function WalletProvider({ children }: { children: ReactNode }) {
    const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(undefined);
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [passphraseErrorText, setPassphraseErrorText] = useState<string>("");
    const [modalAction, setModalAction] = useState<null | "decrypt" | "set-passphrase">(null);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [isMnemonicOpen, setIsMnemonicOpen] = useState(false);
    const [mnemonicError, setMnemonicError] = useState("");
    const [useMnemonic, setUseMnemonic] = useState(false);

    const { setError } = useSnackbar();

    const keymasterRef = useRef<Keymaster | null>(null);

    const walletWeb = new WalletWeb(WALLET_NAME);

    useEffect(() => {
        async function init() {
            await initialiseServices();
            const walletData = await walletWeb.loadWallet();
            if (!walletData) {
                setIsOnboardingOpen(true);
            } else {
                await initialiseWallet();
            }
        }
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function initialiseWallet() {
        const walletData = await walletWeb.loadWallet();

        if (!walletData) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            setModalAction('set-passphrase');
            return;
        }

        const pass = getSessionPassphrase();
        if (pass) {
            let res = await buildKeymaster(pass);
            if (res) {
                return;
            }
            setPassphraseErrorText("");
            clearSessionPassphrase();
        }

        setModalAction('decrypt');
    }

    async function initialiseServices() {
        const gatekeeperUrl = localStorage.getItem(GATEKEEPER_KEY) || DEFAULT_GATEKEEPER_URL;
        const searchServerUrl = localStorage.getItem(SEARCH_SERVER_KEY) || DEFAULT_SEARCH_SERVER_URL;
        localStorage.setItem(GATEKEEPER_KEY, gatekeeperUrl);
        localStorage.setItem(SEARCH_SERVER_KEY, searchServerUrl);
        await gatekeeper.connect({ url: gatekeeperUrl });
        search = await SearchClient.create({ url: searchServerUrl });
    }

    const buildKeymaster = async (passphrase: string) => {
        const instance = new Keymaster({gatekeeper, wallet: walletWeb, cipher, search, passphrase});

        try {
            // check pass
            await instance.loadWallet();
        } catch {
            setPassphraseErrorText("Incorrect passphrase");
            return false;
        }

        setModalAction(null);
        setPassphraseErrorText("");
        keymasterRef.current = instance;
        setSessionPassphrase(passphrase);

        if (useMnemonic) {
            setIsMnemonicOpen(true);
        } else {
            setIsReady(true);
        }

        return true;
    };

    async function handlePassphraseClose() {
        setPassphraseErrorText("");
        setModalAction(null);

        const walletData = await walletWeb.loadWallet();
        if (!walletData) {
            setIsOnboardingOpen(true);
        }
    }

    async function restoreMnemonic(mnemonic: string) {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            throw new Error("Keymaster not initialised");
        }

        await keymaster.newWallet(mnemonic, true);
        await keymaster.recoverWallet();
    }


    const handleOpenNew = async () => {
        setModalAction(null);
        setIsOnboardingOpen(false);
        await initialiseWallet();
    };

    const handleOpenImport = () => {
        setMnemonicError("");
        setIsOnboardingOpen(false);
        setUseMnemonic(true);
        setModalAction('set-passphrase');
    };

    const handleImportMnemonic = async (mnemonic: string) => {
        try {
            await restoreMnemonic(mnemonic);
        } catch (e) {
            setMnemonicError("Invalid mnemonic");
            return;
        }

        setIsMnemonicOpen(false);
        setIsReady(true);
        setUseMnemonic(false);
    };

    const handleCloseMnemonic = () => {
        // Temp wallet was created so wipe it
        wipeWallet();
        setIsMnemonicOpen(false);
        setUseMnemonic(false);
    }

    const wipeWallet = () => {
        try {
            window.localStorage.removeItem(WALLET_NAME);
        } catch (e: any) {
            setError(e);
            return;
        }

        setIsReady(false);
        setIsOnboardingOpen(true);
    };

    const value: WalletContextValue = {
        registry,
        setRegistry,
        manifest,
        setManifest,
        restoreMnemonic,
        wipeWallet,
        initialiseWallet,
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
                onSubmit={buildKeymaster}
                onClose={handlePassphraseClose}
                encrypt={modalAction === 'set-passphrase'}
            />

            <OnboardingModal
                isOpen={isOnboardingOpen}
                onNew={handleOpenNew}
                onImport={handleOpenImport}
            />

            <MnemonicModal
                isOpen={isMnemonicOpen}
                errorText={mnemonicError}
                onSubmit={handleImportMnemonic}
                onClose={handleCloseMnemonic}
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
