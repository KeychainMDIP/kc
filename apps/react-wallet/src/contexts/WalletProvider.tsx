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
import MnemonicHdWalletProvider from "@mdip/keymaster/wallet/mnemonic-hd";
import {
    isLegacyV0,
    isV1Decrypted,
    isV1WithEnc,
    isV2Wallet,
} from "@mdip/keymaster/wallet/typeGuards";
import {
    KeymasterStore,
    MdipWalletBundle,
    MnemonicHdWalletProviderInterface,
    MnemonicHdWalletState,
    StoredWallet,
    WalletFile,
    WalletProviderStore,
} from "@mdip/keymaster/types";
import WalletJsonMemory from "@mdip/keymaster/wallet/json-memory";
import PassphraseModal from "../modals/PassphraseModal";
import WarningModal from "../modals/WarningModal";
import MnemonicModal from "../modals/MnemonicModal";
import { encMnemonic } from "@mdip/keymaster/encryption";
import { takeDeepLink } from "../utils/deepLinkQueue";
import { extractDid } from "../utils/utils";
import {
    DEFAULT_GATEKEEPER_URL,
    DEFAULT_SEARCH_SERVER_URL,
    GATEKEEPER_KEY,
    SEARCH_SERVER_KEY
} from "../constants";
import {
    getSessionPassphrase,
    setSessionPassphrase,
    clearSessionPassphrase,
} from "../utils/sessionPassphrase";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

const KEYMASTER_STORE_NAME = "mdip-keymaster";
const WALLET_PROVIDER_STORE_NAME = "mdip-wallet-provider";

type UploadAction = "upload-legacy-plain" | "upload-legacy-encrypted" | "upload-bundle";

interface WalletContextValue {
    pendingMnemonic: string;
    setPendingMnemonic: Dispatch<SetStateAction<string>>;
    pendingWallet: unknown;
    setPendingWallet: Dispatch<SetStateAction<unknown>>;
    initialiseServices: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
    handleWalletUploadFile: (uploaded: unknown) => Promise<void>;
    refreshFlag: number;
    keymaster: Keymaster | null;
    walletProvider: MnemonicHdWalletProviderInterface | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

let search: SearchClient | undefined;

// eslint-disable-next-line sonarjs/no-hardcoded-passwords
const INCORRECT_PASSPHRASE = "Incorrect passphrase";
const INCOMPLETE_WALLET = "Wallet data is incomplete. Restore from an mdip-wallet-bundle or reset the wallet.";

function createMetadataStore() {
    return new WalletWeb(KEYMASTER_STORE_NAME);
}

function createProviderStore(): WalletProviderStore {
    return new WalletWeb(WALLET_PROVIDER_STORE_NAME) as unknown as WalletProviderStore;
}

function createMemoryProviderStore(): WalletProviderStore {
    return new WalletJsonMemory() as unknown as WalletProviderStore;
}

function createMnemonicWalletProvider(
    passphrase: string,
    store: WalletProviderStore = createProviderStore(),
) {
    return new MnemonicHdWalletProvider({
        store,
        cipher,
        passphrase,
    });
}

function isMdipWalletBundle(wallet: unknown): wallet is MdipWalletBundle {
    if (!wallet || typeof wallet !== "object") {
        return false;
    }

    const bundle = wallet as Partial<MdipWalletBundle>;
    return bundle.version === 1
        && bundle.type === "mdip-wallet-bundle"
        && isV2Wallet(bundle.keymaster)
        && !!bundle.provider
        && bundle.provider.version === 1
        && bundle.provider.type === "mnemonic-hd"
        && !!bundle.provider.rootPublicJwk;
}

async function verifyMnemonicAgainstProviderState(
    providerState: MnemonicHdWalletState,
    mnemonic: string,
) {
    const hdKey = cipher.generateHDKey(mnemonic);
    const { publicJwk } = cipher.generateJwk(hdKey.privateKey!);

    if (cipher.hashJSON(publicJwk) !== cipher.hashJSON(providerState.rootPublicJwk)) {
        throw new Error("Mnemonic does not match wallet.");
    }
}

export function WalletProvider({ children }: { children: ReactNode }) {
    const [passphraseErrorText, setPassphraseErrorText] = useState<string>("");
    const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
    const [pendingWallet, setPendingWallet] = useState<unknown>(null);
    const [modalAction, setModalAction] = useState<null | "decrypt" | "set-passphrase">(null);
    const [uploadAction, setUploadAction] = useState<UploadAction | null>(null);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
    const [showResetSetup, setShowResetSetup] = useState<boolean>(false);
    const [showRecoverMnemonic, setShowRecoverMnemonic] = useState(false);
    const [mnemonicErrorText, setMnemonicErrorText] = useState("");
    const [recoveredMnemonic, setRecoveredMnemonic] = useState("");
    const [showRecoverSetup, setShowRecoverSetup] = useState(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);

    const keymasterRef = useRef<Keymaster | null>(null);
    const walletProviderRef = useRef<MnemonicHdWalletProviderInterface | null>(null);

    useEffect(() => {
        async function init() {
            await initialiseServices();
            await initialiseWallet();
        }

        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function initialiseWallet() {
        const walletStore = createMetadataStore();
        const providerStore = createProviderStore();
        const walletData = await walletStore.loadWallet();
        const providerData = await providerStore.loadWallet();
        const hasIncompleteState =
            (!!providerData && !walletData)
            || (!!walletData && isV2Wallet(walletData) && !providerData);

        const pass = getSessionPassphrase();
        if (!pendingMnemonic && pass && !hasIncompleteState) {
            const res = await buildKeymaster(pass);
            if (res) {
                return;
            }
            setPassphraseErrorText("");
            clearSessionPassphrase();
        }

        if (hasIncompleteState) {
            setPassphraseErrorText(INCOMPLETE_WALLET);
            setModalAction("decrypt");
            return;
        }

        if (!walletData || pendingMnemonic || isLegacyV0(walletData) || isV1Decrypted(walletData)) {
            setPassphraseErrorText("");
            setModalAction("set-passphrase");
        } else {
            setPassphraseErrorText("");
            setModalAction("decrypt");
        }
    }

    async function initialiseServices() {
        const gatekeeperUrl = localStorage.getItem(GATEKEEPER_KEY) || DEFAULT_GATEKEEPER_URL;
        const searchServerUrl = localStorage.getItem(SEARCH_SERVER_KEY) || DEFAULT_SEARCH_SERVER_URL;
        localStorage.setItem(GATEKEEPER_KEY, gatekeeperUrl);
        localStorage.setItem(SEARCH_SERVER_KEY, searchServerUrl);
        await gatekeeper.connect({ url: gatekeeperUrl });
        search = await SearchClient.create({ url: searchServerUrl });
    }

    function createKeymaster(
        passphrase: string,
        store: KeymasterStore = createMetadataStore(),
        providerStore: WalletProviderStore = createProviderStore(),
    ) {
        const walletProvider = createMnemonicWalletProvider(passphrase, providerStore);
        const instance = new Keymaster({
            gatekeeper,
            store,
            walletProvider,
            cipher,
            search,
        });

        return { instance, walletProvider };
    }

    async function activateWallet(
        keymaster: Keymaster,
        walletProvider: MnemonicHdWalletProviderInterface,
        passphrase: string,
    ) {
        setModalAction(null);
        setPendingWallet(null);
        setPendingMnemonic("");
        setRecoveredMnemonic("");
        setUploadAction(null);
        setPassphraseErrorText("");
        keymasterRef.current = keymaster;
        walletProviderRef.current = walletProvider;
        setRefreshFlag((value) => value + 1);
        setIsReady(true);
        setSessionPassphrase(passphrase);
    }

    const buildKeymaster = async (passphrase: string) => {
        const { instance, walletProvider } = createKeymaster(passphrase);

        try {
            if (pendingMnemonic) {
                await instance.newWallet(pendingMnemonic, true);
                await instance.recoverWallet();
            } else {
                await instance.loadWallet();
            }
        } catch {
            setPassphraseErrorText(INCORRECT_PASSPHRASE);
            return false;
        }

        await activateWallet(instance, walletProvider, passphrase);
        return true;
    };

    async function persistWalletData(wallet: WalletFile, providerState: MnemonicHdWalletState) {
        const providerStore = createProviderStore();
        const walletStore = createMetadataStore();

        const providerOk = await providerStore.saveWallet(providerState, true);
        if (!providerOk) {
            throw new Error("save provider wallet failed");
        }

        const walletOk = await walletStore.saveWallet(wallet, true);
        if (!walletOk) {
            throw new Error("save wallet failed");
        }
    }

    async function importLegacyWallet(wallet: StoredWallet, passphrase: string) {
        const memoryStore = new WalletJsonMemory();
        const memoryProviderStore = createMemoryProviderStore();
        const { instance, walletProvider } = createKeymaster(passphrase, memoryStore, memoryProviderStore);

        await memoryStore.saveWallet(wallet, true);
        const normalized = await instance.loadWallet();
        const providerState = await walletProvider.backupWallet();
        await persistWalletData(normalized, providerState);
    }

    async function importWalletBundle(bundle: MdipWalletBundle, passphrase: string) {
        const memoryStore = new WalletJsonMemory();
        const memoryProviderStore = createMemoryProviderStore();
        const { instance, walletProvider } = createKeymaster(passphrase, memoryStore, memoryProviderStore);

        await memoryStore.saveWallet(bundle.keymaster, true);
        await walletProvider.saveWallet(bundle.provider, true);
        const normalized = await instance.loadWallet();
        const providerState = await walletProvider.backupWallet();
        await persistWalletData(normalized, providerState);
    }

    async function handlePassphraseSubmit(passphrase: string) {
        setPassphraseErrorText("");

        if (uploadAction && pendingWallet) {
            try {
                if (uploadAction === "upload-bundle" && isMdipWalletBundle(pendingWallet)) {
                    await importWalletBundle(pendingWallet, passphrase);
                } else {
                    await importLegacyWallet(pendingWallet as StoredWallet, passphrase);
                }
            } catch {
                setPassphraseErrorText(
                    modalAction === "decrypt" ? INCORRECT_PASSPHRASE : "Failed to import wallet."
                );
                return;
            }
        }

        await buildKeymaster(passphrase);
    }

    async function handlePassphraseClose() {
        setPendingWallet(null);
        setPendingMnemonic("");
        setRecoveredMnemonic("");
        setPassphraseErrorText("");

        const walletData = await createMetadataStore().loadWallet();
        const providerData = await createProviderStore().loadWallet();
        if (walletData || providerData) {
            setModalAction(null);
        }
    }

    function openEvent(did: string, type: string) {
        const evt = new CustomEvent(type, { detail: { did } });
        window.dispatchEvent(evt);
    }

    function parseMdip(url: string): { action?: string; did?: string | null } {
        try {
            const parsedUrl = new URL(url.replace(/^mdip:\/\//, "https://"));
            const action = (parsedUrl.hostname || parsedUrl.pathname.replace(/^\//, "") || "").toLowerCase();
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

            if (action === "accept" && did) {
                openEvent(did, "mdip:openAccept");
                return;
            }

            if (did) {
                openEvent(did, "mdip:openAuth");
            }
        };

        handleQueued();
        window.addEventListener("mdip:deepLinkQueued", handleQueued);
        return () => window.removeEventListener("mdip:deepLinkQueued", handleQueued);
    }, [isReady]);

    async function handleWalletUploadFile(uploaded: unknown) {
        setPendingWallet(uploaded);

        if (isMdipWalletBundle(uploaded)) {
            setUploadAction("upload-bundle");
            setModalAction("decrypt");
            return;
        }

        if (isLegacyV0(uploaded) || isV1Decrypted(uploaded)) {
            setUploadAction("upload-legacy-plain");
            setModalAction("set-passphrase");
            return;
        }

        if (isV1WithEnc(uploaded)) {
            setUploadAction("upload-legacy-encrypted");
            setModalAction("decrypt");
            return;
        }

        if (isV2Wallet(uploaded)) {
            window.alert("Standalone keymaster metadata is not enough. Upload an mdip-wallet-bundle instead.");
            return;
        }

        window.alert("Unsupported wallet type");
    }

    function handleStartReset() {
        setPassphraseErrorText("");
        setShowResetConfirm(true);
    }

    function handleStartRecover() {
        setMnemonicErrorText("");
        setRecoveredMnemonic("");
        setShowRecoverMnemonic(true);
        setPassphraseErrorText("");

        if (uploadAction !== null) {
            setModalAction(null);
        }
    }

    function handleConfirmReset() {
        setShowResetConfirm(false);
        setShowResetSetup(true);
    }

    function handleCancelReset() {
        setShowResetConfirm(false);
    }

    async function handleResetPassphraseSubmit(newPassphrase: string) {
        try {
            const { instance } = createKeymaster(newPassphrase);
            await instance.newWallet(undefined, true);
            setShowResetSetup(false);
            await buildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText("Failed to reset wallet. Try again.");
        }
    }

    async function handleRecoverMnemonicSubmit(mnemonic: string) {
        setMnemonicErrorText("");

        try {
            const walletStore = createMetadataStore();
            const providerStore = createProviderStore();
            const storedWallet = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletStore.loadWallet();

            if (isV1WithEnc(storedWallet)) {
                const hdKey = cipher.generateHDKey(mnemonic);
                const { publicJwk, privateJwk } = cipher.generateJwk(hdKey.privateKey!);
                cipher.decryptMessage(publicJwk, privateJwk, storedWallet.enc);
            } else {
                const providerState = isMdipWalletBundle(pendingWallet)
                    ? pendingWallet.provider
                    : await providerStore.loadWallet();

                if (!providerState) {
                    setMnemonicErrorText("Recovery not available for this wallet type.");
                    return;
                }

                await verifyMnemonicAgainstProviderState(providerState, mnemonic);
            }

            setRecoveredMnemonic(mnemonic);
            setShowRecoverMnemonic(false);
            setShowRecoverSetup(true);
        } catch {
            setMnemonicErrorText("Mnemonic is incorrect. Try again.");
        }
    }

    async function handleRecoverPassphraseSubmit(newPassphrase: string) {
        if (!recoveredMnemonic) {
            return;
        }

        try {
            const walletStore = createMetadataStore();
            const providerStore = createProviderStore();
            const storedWallet = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletStore.loadWallet();

            if (isV1WithEnc(storedWallet)) {
                const mnemonicEnc = await encMnemonic(recoveredMnemonic, newPassphrase);
                const updatedWallet = {
                    version: storedWallet.version,
                    seed: { mnemonicEnc },
                    enc: storedWallet.enc,
                } satisfies StoredWallet;

                await importLegacyWallet(updatedWallet, newPassphrase);
            } else {
                const providerState = isMdipWalletBundle(pendingWallet)
                    ? pendingWallet.provider
                    : await providerStore.loadWallet();

                if (!providerState) {
                    setPassphraseErrorText("Recovery not available for this wallet type.");
                    return;
                }

                const recoveryProvider = createMnemonicWalletProvider(newPassphrase, createMemoryProviderStore());
                await recoveryProvider.saveWallet(providerState, true);
                await recoveryProvider.changePassphrase(recoveredMnemonic, newPassphrase);
                const updatedProviderState = await recoveryProvider.backupWallet();

                if (isMdipWalletBundle(pendingWallet)) {
                    await persistWalletData(pendingWallet.keymaster, updatedProviderState);
                } else {
                    const wallet = await walletStore.loadWallet();
                    if (!wallet || !isV2Wallet(wallet)) {
                        setPassphraseErrorText("Recovery not available for this wallet type.");
                        return;
                    }

                    await persistWalletData(wallet, updatedProviderState);
                }
            }

            setRecoveredMnemonic("");
            setShowRecoverSetup(false);
            await buildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText("Failed to update passphrase. Try again.");
        }
    }

    const value: WalletContextValue = {
        pendingMnemonic,
        setPendingMnemonic,
        pendingWallet,
        setPendingWallet,
        initialiseServices,
        initialiseWallet,
        handleWalletUploadFile,
        refreshFlag,
        keymaster: keymasterRef.current,
        walletProvider: walletProviderRef.current,
    };

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null && !showResetSetup && !showRecoverSetup}
                title={modalAction === "set-passphrase"
                    ? "Set a Passphrase" : "Enter Your Wallet Passphrase"}
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handlePassphraseClose}
                encrypt={modalAction === "set-passphrase"}
                showCancel={pendingWallet !== null}
                upload={uploadAction !== null}
                onStartReset={handleStartReset}
                onStartRecover={
                    modalAction === "decrypt"
                    && (uploadAction === null
                        || uploadAction === "upload-legacy-encrypted"
                        || uploadAction === "upload-bundle")
                        ? handleStartRecover
                        : undefined
                }
            />

            <MnemonicModal
                isOpen={showRecoverMnemonic}
                errorText={mnemonicErrorText}
                onSubmit={handleRecoverMnemonicSubmit}
                onClose={() => setShowRecoverMnemonic(false)}
            />

            <WarningModal
                isOpen={showResetConfirm}
                title="Overwrite wallet with a new one?"
                warningText="This will delete your current wallet data in this browser and create a brand new one."
                onSubmit={handleConfirmReset}
                onClose={handleCancelReset}
            />

            <PassphraseModal
                isOpen={showResetSetup}
                title="Set a Passphrase"
                errorText={passphraseErrorText}
                onSubmit={handleResetPassphraseSubmit}
                onClose={() => setShowResetSetup(false)}
                encrypt={true}
                showCancel={true}
            />

            <PassphraseModal
                isOpen={showRecoverSetup}
                title="Set a New Passphrase"
                errorText={passphraseErrorText}
                onSubmit={handleRecoverPassphraseSubmit}
                onClose={() => setShowRecoverSetup(false)}
                encrypt={true}
                showCancel={true}
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
