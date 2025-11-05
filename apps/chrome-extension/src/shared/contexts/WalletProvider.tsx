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
import SearchClient from "@mdip/keymaster/search";
import CipherWeb from "@mdip/cipher/web";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import { isEncryptedWallet, isLegacyV0, isV1Decrypted, isV1WithEnc } from '@mdip/keymaster/wallet/typeGuards';
import { StoredWallet, WalletBase } from "@mdip/keymaster/types";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import { useSnackbar } from "./SnackbarProvider";
import PassphraseModal from "../PassphraseModal";
import WalletJsonMemory from "@mdip/keymaster/wallet/json-memory";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface WalletContextValue {
    currentId: string;
    setCurrentId: (value: string) => Promise<void>;
    validId: boolean;
    setValidId: Dispatch<SetStateAction<boolean>>;
    currentDID: string;
    setCurrentDID: Dispatch<SetStateAction<string>>;
    registry: string;
    setRegistry: (value: string) => Promise<void>;
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
    storeState: (key: string, value: string | boolean) => Promise<void>;
    refreshWalletStored: (state: Record<string, any>) => Promise<void>;
    resetWalletState: () => void;
    isBrowser: boolean;
    reloadBrowserWallet: () => Promise<void>;
    refreshFlag: number;
    keymaster: Keymaster | null;
}

const WalletContext = createContext<WalletContextValue | null>(null);

let search: SearchClient | undefined;

const INCORRECT_PASSPHRASE = "Incorrect passphrase";

export function WalletProvider({ children, isBrowser }: { children: ReactNode, isBrowser: boolean }) {
    const [currentId, setCurrentIdState] = useState<string>("");
    const [validId, setValidId] = useState<boolean>(false);
    const [currentDID, setCurrentDID] = useState<string>("");
    const [idList, setIdList] = useState<string[]>([]);
    const [unresolvedIdList, setUnresolvedIdList] = useState<string[]>([]);
    const [manifest, setManifest] = useState<Record<string, unknown> | undefined>(undefined);
    const [registry, setRegistryState] = useState<string>("hyperswarm");
    const [registries, setRegistries] = useState<string[]>([]);
    const [passphraseErrorText, setPassphraseErrorText] = useState<string>("");
    const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
    const [pendingWallet, setPendingWallet] = useState<unknown>(null);
    const [modalAction, setModalAction] = useState<null | "decrypt" | "set-passphrase">(null);
    const [uploadAction, setUploadAction] = useState<null | "upload-plain-v0" | "upload-plain-v1" | "upload-enc-v0" | "upload-enc-v1">(null);
    const [isReady, setIsReady] = useState<boolean>(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);
    const { setError } = useSnackbar();

    const keymasterRef = useRef<Keymaster | null>(null);

    const walletChrome = new WalletChrome();

    useEffect(() => {
        const initWallet = async () => {
            await initialiseServices();
            await initialiseWallet();
        }

        initWallet();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function initialiseWallet() {
        const walletData = await walletChrome.loadWallet();

        let response = await chrome.runtime.sendMessage({
            action: "GET_PASSPHRASE",
        });
        const pass = response?.passphrase || "";

        if (!pendingMnemonic && pass) {
            let res = await rebuildKeymaster(pass);
            if (res) {
                return;
            }
            setPassphraseErrorText("");
            await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        }

        console.log(walletData);

        if (!walletData || pendingMnemonic || isLegacyV0(walletData)) {
            // eslint-disable-next-line sonarjs/no-duplicate-string
            setModalAction('set-passphrase');
        } else {
            setModalAction('decrypt');
        }
    }

    async function initialiseServices() {
        const { gatekeeperUrl, searchServerUrl } = await chrome.storage.sync.get([
            "gatekeeperUrl",
            "searchServerUrl"
        ]);
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
        await chrome.runtime.sendMessage({
            action: "STORE_PASSPHRASE",
            passphrase,
        });

        return true;
    };

    async function rebuildKeymaster(passphrase: string) {
        const walletEnc = new WalletWebEncrypted(walletChrome, passphrase);
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
                        await walletChrome.saveWallet(decrypted, true);
                    } else { // upload-enc-v1 & upload-plain-v1
                        const km = new Keymaster({ gatekeeper, wallet: walletMemory, cipher, search, passphrase });
                        // check pass
                        await km.loadWallet();
                        await walletChrome.saveWallet(pendingWallet as StoredWallet, true);
                    }
                } catch {
                    setPassphraseErrorText(INCORRECT_PASSPHRASE);
                    return;
                }
            } else { // upload-plain-v0
                await walletChrome.saveWallet(pendingWallet as StoredWallet, true);
            }
        } else if (!pendingMnemonic) {
            const wallet = await walletChrome.loadWallet();
            if (isEncryptedWallet(wallet)) {
                try {
                    const walletEnc = new WalletWebEncrypted(walletChrome, passphrase);
                    // check pass & remove encyption wrapper
                    const decrypted = await walletEnc.loadWallet();
                    await walletChrome.saveWallet(decrypted, true);
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

        const walletData = await walletChrome.loadWallet();
        if (walletData) {
            setModalAction(null);
        }
    }

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

    async function refreshWalletStored(state: Record<string, any>) {
        if (state.registry) {
            setRegistryState(state.registry);
        }
    }

    async function reloadBrowserWallet() {
        if (!isBrowser) {
            return;
        }

        let response = await chrome.runtime.sendMessage({
            action: "GET_PASSPHRASE",
        });
        const pass = response?.passphrase || "";
        if (!pass) {
            return;
        }

        await rebuildKeymaster(pass);
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

    async function handleWalletUploadFile(uploaded: unknown) {
        setPendingWallet(uploaded);

        if (isLegacyV0(uploaded)) {
            setUploadAction('upload-plain-v0');
            setModalAction('set-passphrase');
        } else if (isV1Decrypted(uploaded)) {
            setUploadAction('upload-plain-v1');
            setModalAction('decrypt');
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
        storeState,
        resetWalletState,
        refreshWalletStored,
        reloadBrowserWallet,
        refreshFlag,
        isBrowser,
        keymaster: keymasterRef.current,
    };

    return (
        <>
            <PassphraseModal
                isOpen={modalAction !== null}
                title={
                    modalAction === 'set-passphrase'
                        ? 'Set a Passphrase' : 'Enter Your Wallet Passphrase'
                }
                errorText={passphraseErrorText}
                onSubmit={handlePassphraseSubmit}
                onClose={handlePassphraseClose}
                encrypt={modalAction === 'set-passphrase'}
                showCancel={pendingWallet !== null}
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
