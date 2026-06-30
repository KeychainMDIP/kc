import {
    createContext,
    Dispatch,
    ReactNode,
    SetStateAction,
    useContext,
    useEffect,
    useMemo,
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
import VerifyMnemonicModal from "../modals/VerifyMnemonicModal";
import WarningModal from "../modals/WarningModal";

const cipher = new CipherWeb();
const SERVICE_READY_TIMEOUT_MS = 3_000;

type ServiceClients = {
    gatekeeper: GatekeeperClient;
    search: SearchClient;
};

interface WalletContextValue {
    manifest: Record<string, unknown> | undefined;
    setManifest: Dispatch<SetStateAction<Record<string, unknown> | undefined>>;
    registry: string;
    setRegistry: Dispatch<SetStateAction<string>>;
    wipeWallet: () => void;
    restoreMnemonic: (mnemonic: string) => Promise<void>;
    updateServices: (gatekeeperUrl: string, searchServerUrl: string) => Promise<void>;
    keymaster: Keymaster | null;
    search?: SearchClient;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
    const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(undefined);
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [services, setServices] = useState<ServiceClients | null>(null);
    const [keymaster, setKeymaster] = useState<Keymaster | null>(null);
    const [passphraseErrorText, setPassphraseErrorText] = useState<string>("");
    const [modalAction, setModalAction] = useState<null | "decrypt" | "set-passphrase">(null);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [isMnemonicOpen, setIsMnemonicOpen] = useState(false);
    const [mnemonicError, setMnemonicError] = useState("");
    const [useMnemonic, setUseMnemonic] = useState(false);
    const [newWallet, setNewWallet] = useState(false);
    const [revealMnemonic, setRevealMnemonic] = useState("");
    const [isVerifyMnemonicOpen, setIsVerifyMnemonicOpen] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);

    const { setError } = useSnackbar();

    const walletWeb = useMemo(() => new WalletWeb(WALLET_NAME), []);
    const resetFlowRef = useRef(false);

    useEffect(() => {
        async function init() {
            const initialServices = await initialiseServices();
            const walletData = await walletWeb.loadWallet();
            if (!walletData) {
                setIsOnboardingOpen(true);
            } else {
                await initialiseWallet(initialServices);
            }
        }
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function initialiseWallet(serviceClients?: ServiceClients) {
        const walletData = await walletWeb.loadWallet();

        if (!walletData) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            setModalAction('set-passphrase');
            return;
        }

        const pass = getSessionPassphrase();
        if (pass) {
            let res = await buildKeymaster(pass, serviceClients);
            if (res) {
                return;
            }
            setPassphraseErrorText("");
            clearSessionPassphrase();
        }

        setModalAction('decrypt');
    }

    async function createServiceClients(
        gatekeeperUrl: string,
        searchServerUrl: string,
        checkReady = false
    ): Promise<ServiceClients> {
        const nextGatekeeper = new GatekeeperClient();
        await nextGatekeeper.connect({ url: gatekeeperUrl });

        if (checkReady) {
            await requireServiceReady("Gatekeeper", () => nextGatekeeper.isReady());
        }

        const nextSearch = await SearchClient.create({ url: searchServerUrl });

        if (checkReady) {
            await requireServiceReady("Search server", () => nextSearch.isReady());
        }

        return {
            gatekeeper: nextGatekeeper,
            search: nextSearch,
        };
    }

    async function requireServiceReady(
        name: string,
        isReady: () => Promise<boolean>
    ): Promise<void> {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<boolean>((_, reject) => {
            timeoutId = setTimeout(
                () => reject(new Error(`${name} readiness check timed out`)),
                SERVICE_READY_TIMEOUT_MS
            );
        });

        let ready: boolean;
        try {
            ready = await Promise.race([isReady(), timeout]);
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }

        if (!ready) {
            throw new Error(`${name} is not reachable`);
        }
    }

    async function initialiseServices(): Promise<ServiceClients> {
        const gatekeeperUrl = localStorage.getItem(GATEKEEPER_KEY) || DEFAULT_GATEKEEPER_URL;
        const searchServerUrl = localStorage.getItem(SEARCH_SERVER_KEY) || DEFAULT_SEARCH_SERVER_URL;
        const initialServices = await createServiceClients(gatekeeperUrl, searchServerUrl);
        localStorage.setItem(GATEKEEPER_KEY, gatekeeperUrl);
        localStorage.setItem(SEARCH_SERVER_KEY, searchServerUrl);
        setServices(initialServices);
        return initialServices;
    }

    async function updateServices(gatekeeperUrl: string, searchServerUrl: string) {
        const nextServices = await createServiceClients(gatekeeperUrl, searchServerUrl, true);
        let nextKeymaster = keymaster;

        if (keymaster) {
            const passphrase = getSessionPassphrase();
            if (!passphrase) {
                throw new Error("Current wallet passphrase is required to update services");
            }

            nextKeymaster = await buildKeymasterInstance(passphrase, nextServices);
            if (!nextKeymaster) {
                throw new Error("Failed to rebuild wallet services");
            }
        }

        localStorage.setItem(GATEKEEPER_KEY, gatekeeperUrl);
        localStorage.setItem(SEARCH_SERVER_KEY, searchServerUrl);
        setServices(nextServices);
        setKeymaster(nextKeymaster);
    }

    async function buildKeymasterInstance(
        passphrase: string,
        serviceClients?: ServiceClients,
        passphraseFailureText?: string
    ): Promise<Keymaster | null> {
        const activeServices = serviceClients ?? services;
        if (!activeServices) {
            throw new Error("Services not initialised");
        }

        const instance = new Keymaster({
            gatekeeper: activeServices.gatekeeper,
            wallet: walletWeb,
            cipher,
            search: activeServices.search,
            passphrase,
        });

        try {
            // check pass
            await instance.loadWallet();
        } catch (error) {
            if (passphraseFailureText) {
                setPassphraseErrorText(passphraseFailureText);
                return null;
            }
            throw error;
        }

        return instance;
    }

    const buildKeymaster = async (passphrase: string, serviceClients?: ServiceClients) => {
        let instance: Keymaster | null;
        try {
            instance = await buildKeymasterInstance(passphrase, serviceClients, "Incorrect passphrase");
        } catch (error: any) {
            setError(error);
            return false;
        }

        if (!instance) {
            return false;
        }

        setModalAction(null);
        setPassphraseErrorText("");
        setKeymaster(instance);
        setSessionPassphrase(passphrase);

        if (useMnemonic) {
            setIsMnemonicOpen(true);
        } else if (newWallet) {
            try {
                const mnemonic = await instance.decryptMnemonic();
                setRevealMnemonic(mnemonic);
                setIsMnemonicOpen(true);
            } catch (e: any) {
                setError(e);
                setNewWallet(false);
                wipeWallet();
            }
        } else {
            setIsReady(true);
        }

        return true;
    };

    async function handlePassphraseClose() {
        if (showResetConfirm || resetFlowRef.current) {
            return;
        }

        setPassphraseErrorText("");
        setModalAction(null);

        const walletData = await walletWeb.loadWallet();
        if (!walletData) {
            setIsOnboardingOpen(true);
        }
    }

    async function restoreMnemonic(mnemonic: string) {
        if (!keymaster) {
            throw new Error("Keymaster not initialised");
        }

        await keymaster.newWallet(mnemonic, true);
        await keymaster.recoverWallet();
    }


    const handleOpenNew = async () => {
        setModalAction(null);
        setIsOnboardingOpen(false);
        setNewWallet(true);
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
        } catch {
            setMnemonicError("Invalid mnemonic");
            return;
        }

        setIsMnemonicOpen(false);
        setIsReady(true);
        setUseMnemonic(false);
    };

    const handleCloseMnemonic = () => {
        setIsMnemonicOpen(false);

        if (useMnemonic) {
            // Temp wallet was created so wipe it
            wipeWallet();
            setUseMnemonic(false);
        }

        if (newWallet) {
            setIsVerifyMnemonicOpen(true);
        }
    }

    const handleVerifyMnemonic = async () => {
        setIsVerifyMnemonicOpen(false);
        setIsReady(true);
        setNewWallet(false);
        setRevealMnemonic("");
    }

    const handleVerifyMnemonicBack = () => {
        setIsVerifyMnemonicOpen(false);
        setIsMnemonicOpen(true);
    }

    const handleStartReset = () => {
        resetFlowRef.current = true;
        setPassphraseErrorText("");
        setShowResetConfirm(true);
    };

    const handleConfirmReset = () => {
        setShowResetConfirm(false);
        resetFlowRef.current = false;
        wipeWallet();
    };

    const handleCancelReset = () => {
        setShowResetConfirm(false);
        setModalAction("decrypt");
        setTimeout(() => {
            resetFlowRef.current = false;
        }, 0);
    };

    const wipeWallet = () => {
        try {
            window.localStorage.removeItem(WALLET_NAME);
            clearSessionPassphrase();
        } catch (e: any) {
            setError(e);
            return;
        }

        setKeymaster(null);
        setManifest(undefined);
        setPassphraseErrorText("");
        setModalAction(null);
        setShowResetConfirm(false);
        resetFlowRef.current = false;
        setIsMnemonicOpen(false);
        setMnemonicError("");
        setUseMnemonic(false);
        setNewWallet(false);
        setRevealMnemonic("");
        setIsVerifyMnemonicOpen(false);
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
        updateServices,
        keymaster,
        search: services?.search,
    };

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null && !showResetConfirm}
                title={
                    modalAction === "decrypt"
                        ? "Enter Your Wallet Passphrase"
                        : "Set Your Wallet Passphrase"
                }
                errorText={passphraseErrorText}
                onSubmit={buildKeymaster}
                onClose={handlePassphraseClose}
                encrypt={modalAction === 'set-passphrase'}
                onStartReset={modalAction === "decrypt" ? handleStartReset : undefined}
            />

            <WarningModal
                isOpen={showResetConfirm}
                title="Reset Wallet"
                warningText="This will delete the wallet stored on this device and create a brand new one. You will not be able to recover the old wallet without its mnemonic or backup."
                onSubmit={handleConfirmReset}
                onClose={handleCancelReset}
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
                mnemonic={revealMnemonic || undefined}
            />

            {newWallet && (
                <VerifyMnemonicModal
                    isOpen={isVerifyMnemonicOpen}
                    mnemonic={revealMnemonic}
                    onBack={handleVerifyMnemonicBack}
                    onSuccess={handleVerifyMnemonic}
                />
            )}

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
