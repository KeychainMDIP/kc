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
import { WalletBase, StoredWallet } from '@mdip/keymaster/types';
import { isEncryptedWallet, isV1WithEnc, isLegacyV0 } from '@mdip/keymaster/wallet/typeGuards';
import SearchClient from "@mdip/keymaster/search";
import CipherWeb from "@mdip/cipher";
import WalletWeb from "@mdip/keymaster/wallet/web";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import WalletJsonMemory from "@mdip/keymaster/wallet/json-memory";
import { useSnackbar } from "./SnackbarProvider";
import PassphraseModal from "../components/modals/PassphraseModal";
import WarningModal from "../components/modals/WarningModal";
import MnemonicModal from "../components/modals/MnemonicModal";
import { encMnemonic } from '@mdip/keymaster/encryption';
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
    pendingWallet: unknown;
    setPendingWallet: Dispatch<SetStateAction<unknown>>;
    resolveDID: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
    handleWalletUploadFile: (uploaded: unknown) => Promise<void>;
    refreshFlag: number;
    keymaster: Keymaster | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

let search: SearchClient | undefined;

const INCORRECT_PASSPHRASE = "Incorrect passphrase";

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
    const [pendingWallet, setPendingWallet] = useState<unknown>(null);
    const [modalAction, setModalAction] = useState<null | "decrypt" | "set-passphrase">(null);
    const [uploadAction, setUploadAction] = useState<null | "upload-plain-v0" | "upload-enc-v0" | "upload-enc-v1">(null);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
    const [showResetSetup, setShowResetSetup] = useState<boolean>(false);
    const [showRecoverMnemonic, setShowRecoverMnemonic] = useState(false);
    const [mnemonicErrorText, setMnemonicErrorText] = useState("");
    const [recoveredMnemonic, setRecoveredMnemonic] = useState("");
    const [showRecoverSetup, setShowRecoverSetup] = useState(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);
    const { setError } = useSnackbar();

    const keymasterRef = useRef<Keymaster | null>(null);

    const walletWeb = new WalletWeb();

    useEffect(() => {
        async function init() {
            await initialiseServices()
            await initialiseWallet();
        }
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function initialiseWallet() {
        const walletData = await walletWeb.loadWallet();

        const pass = getSessionPassphrase();
        if (!pendingMnemonic && pass) {
            const res = await rebuildKeymaster(pass);
            if (res) {
                return;
            }
            setPassphraseErrorText("");
            clearSessionPassphrase();
        }

        if (!walletData || pendingMnemonic || isLegacyV0(walletData)) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            setModalAction('set-passphrase');
        } else {
            setModalAction('decrypt');
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

    const buildKeymaster = async (wallet: WalletBase, passphrase: string) => {
        const instance = new Keymaster({gatekeeper, wallet, cipher, search, passphrase});

        if (pendingMnemonic) {
            await instance.newWallet(pendingMnemonic, true);
            await instance.recoverWallet();
        } else {
            try {
                // check pass & convert to v1 if needed
                await instance.loadWallet();
            } catch {
                setPassphraseErrorText(INCORRECT_PASSPHRASE);
                return false;
            }
        }

        setModalAction(null);
        setPendingWallet(null);
        setPendingMnemonic("");
        setUploadAction(null);
        setPassphraseErrorText("");
        keymasterRef.current = instance;
        setRefreshFlag(r => r + 1);
        setIsReady(true);
        setSessionPassphrase(passphrase);

        return true;
    };

    async function rebuildKeymaster(passphrase: string) {
        const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
        const walletCached = new WalletCache(walletEnc);
        return await buildKeymaster(walletCached, passphrase);
    }

    async function handlePassphraseSubmit(passphrase: string) {
        setPassphraseErrorText("");

        const walletMemory = new WalletJsonMemory();

        if (uploadAction && pendingWallet) {
            if (modalAction === 'decrypt') {
                await walletMemory.saveWallet(pendingWallet as StoredWallet, true);

                try {
                    if (uploadAction === 'upload-enc-v0') {
                        const walletEnc = new WalletWebEncrypted(walletMemory, passphrase);
                        // check pass & remove encyption wrapper
                        const decrypted = await walletEnc.loadWallet();
                        await walletWeb.saveWallet(decrypted, true);
                    } else { // upload-enc-v1
                        const km = new Keymaster({ gatekeeper, wallet: walletMemory, cipher, search, passphrase });
                        // check pass
                        await km.loadWallet();
                        await walletWeb.saveWallet(pendingWallet as StoredWallet, true);
                    }
                } catch {
                    setPassphraseErrorText(INCORRECT_PASSPHRASE);
                    return;
                }
            } else { // upload-plain-v0
                await walletWeb.saveWallet(pendingWallet as StoredWallet, true);
            }
        } else if (!pendingMnemonic) {
            const wallet = await walletWeb.loadWallet();
            if (isEncryptedWallet(wallet)) {
                try {
                    const walletEnc = new WalletWebEncrypted(walletWeb, passphrase);
                    // check pass & remove encyption wrapper
                    const decrypted = await walletEnc.loadWallet();
                    await walletWeb.saveWallet(decrypted, true);
                } catch {
                    setPassphraseErrorText(INCORRECT_PASSPHRASE);
                    return;
                }
            }
        }

        await rebuildKeymaster(passphrase);
    }

    async function handlePassphraseClose() {
        setPendingWallet(null);
        setPendingMnemonic("");
        setPassphraseErrorText("");

        const walletData = await walletWeb.loadWallet();
        if (walletData) {
            setModalAction(null);
        }
    }

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

    async function handleWalletUploadFile(uploaded: unknown) {
        setPendingWallet(uploaded);

        if (isLegacyV0(uploaded)) {
            setUploadAction('upload-plain-v0');
            setModalAction('set-passphrase');
        } else if (isV1WithEnc(uploaded)) {
            setUploadAction('upload-enc-v1');
            setModalAction('decrypt');
        } else if (isEncryptedWallet(uploaded)) {
            setUploadAction('upload-enc-v0');
            setModalAction('decrypt');
        } else {
            window.alert('Unsupported wallet type');
        }
    }

    function handleStartReset() {
        setPassphraseErrorText("");
        setShowResetConfirm(true);
    }

    function handleStartRecover() {
        setMnemonicErrorText("");
        setShowRecoverMnemonic(true);
        setPassphraseErrorText("");

        // only nullify modalAction if we are uploading a wallet, otherwise
        // leave passphrase modal open in case the user cancels
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
            const walletWeb = new WalletWeb();
            const km = new Keymaster({ gatekeeper, wallet: walletWeb, cipher, search, passphrase: newPassphrase });
            await km.newWallet(undefined, true);
            setShowResetSetup(false);
            await rebuildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText('Failed to reset wallet. Try again.');
        }
    }

    async function handleRecoverMnemonicSubmit(mnemonic: string) {
        setMnemonicErrorText("");
        try {
            const walletWeb = new WalletWeb();
            let stored = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletWeb.loadWallet();

            if (!isV1WithEnc(stored)) {
                setMnemonicErrorText('Recovery not available for this wallet type.');
                return;
            }

            const hdkey = cipher.generateHDKey(mnemonic);
            const { publicJwk, privateJwk } = cipher.generateJwk(hdkey.privateKey!);
            cipher.decryptMessage(publicJwk, privateJwk, stored.enc);

            setRecoveredMnemonic(mnemonic);
            setShowRecoverMnemonic(false);
            setShowRecoverSetup(true);
        } catch {
            setMnemonicErrorText('Mnemonic is incorrect. Try again.');
        }
    }

    async function handleRecoverPassphraseSubmit(newPassphrase: string) {
        if (!recoveredMnemonic) {
            return;
        }
        try {
            const walletWeb = new WalletWeb();
            const base = pendingWallet && isV1WithEnc(pendingWallet)
                ? pendingWallet
                : await walletWeb.loadWallet();

            if (!isV1WithEnc(base)) {
                setPassphraseErrorText('Recovery not available for this wallet type.');
                return;
            }

            const mnemonicEnc = await encMnemonic(recoveredMnemonic, newPassphrase);
            const updated = {
                version: base.version,
                seed: { mnemonicEnc },
                enc: base.enc
            };

            await walletWeb.saveWallet(updated, true);
            setRecoveredMnemonic("");
            setShowRecoverSetup(false);
            await rebuildKeymaster(newPassphrase);
        } catch {
            setPassphraseErrorText('Failed to update passphrase. Try again.');
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
        pendingWallet,
        setPendingWallet,
        resolveDID,
        initialiseWallet,
        handleWalletUploadFile,
        refreshFlag,
        keymaster: keymasterRef.current,
    };

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null && !showResetSetup && !showRecoverSetup}
                title={modalAction === 'set-passphrase'
                    ? 'Set a Passphrase' : 'Enter Your Wallet Passphrase'}
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handlePassphraseClose}
                encrypt={modalAction === 'set-passphrase'}
                showCancel={pendingWallet !== null}
                upload={uploadAction !== null}
                onStartReset={handleStartReset}
                onStartRecover={
                    modalAction === 'decrypt' &&
                    (uploadAction === null || uploadAction === 'upload-enc-v1')
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
