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
import { isEncryptedWallet } from '@mdip/keymaster/wallet/typeGuards'
import type { WalletFile } from '@mdip/keymaster/types'
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import { useSnackbar } from "./SnackbarProvider";
import PassphraseModal from "../PassphraseModal";

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
    resolveDID: () => Promise<void>;
    initialiseWallet: () => Promise<void>;
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
    const [modalAction, setModalAction] = useState<string>("");
    const [isReady, setIsReady] = useState<boolean>(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);
    const { setError } = useSnackbar();

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


    const keymasterRef = useRef<Keymaster | null>(null);

    async function initialiseWallet() {
        const { gatekeeperUrl, searchServerUrl } = await chrome.storage.sync.get([
            "gatekeeperUrl",
            "searchServerUrl"
        ]);
        await gatekeeper.connect({ url: gatekeeperUrl });
        search = await SearchClient.create({ url: searchServerUrl });

        const wallet = new WalletChrome();
        const walletData = await wallet.loadWallet();

        let pass = "";
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

    async function reloadBrowserWallet() {
        if (!isBrowser) {
            return;
        }

        let pass = "";
        let response = await chrome.runtime.sendMessage({
            action: "GET_PASSPHRASE",
        });
        if (response && response.passphrase) {
            pass = response.passphrase;
        }

        if (!pass) {
            return;
        }

        const wallet_chrome = new WalletChrome();
        const wallet_enc = new WalletWebEncrypted(wallet_chrome, pass);
        const wallet_cache = new WalletCache(wallet_enc);

        keymasterRef.current = new Keymaster({
            gatekeeper,
            wallet: wallet_cache,
            cipher,
            search,
        });
    }

    useEffect(() => {
        initialiseWallet();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function clearStoredPassphrase() {
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
    }

    async function decryptWallet(passphrase: string, modal = false) {
        const wallet_chrome = new WalletChrome();
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
            search,
        });

        setIsReady(true);
        setModalAction("");
        setPassphraseErrorText("");
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
        resolveDID,
        initialiseWallet,
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
