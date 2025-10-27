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
import { isEncryptedWallet } from '@mdip/keymaster/wallet/typeGuards';
import type { WalletFile } from '@mdip/keymaster/types';
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
import { useSnackbar } from "./SnackbarProvider";
import PassphraseModal from "../PassphraseModal";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

type InitIntent = "unlock" | "setup" | "restore";

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
    walletAction: "" | "decrypt" | "encrypt" | "restore";
    setWalletAction: Dispatch<SetStateAction<"" | "decrypt" | "encrypt" | "restore">>;
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
    const [pendingMnemonic, setPendingMnemonic] = useState<string>("");
    const [walletAction, setWalletAction] = useState<"" | "decrypt" | "encrypt" | "restore">("");
    const [isReady, setIsReady] = useState<boolean>(false);
    const [refreshFlag, setRefreshFlag] = useState<number>(0);
    const { setError } = useSnackbar();

    const keymasterRef = useRef<Keymaster | null>(null);

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

    useEffect(() => {
        if (walletAction) {
            setPassphraseErrorText("");
        }
    }, [walletAction]);

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

    async function initialiseWallet() {
        const { gatekeeperUrl, searchServerUrl } = await chrome.storage.sync.get([
            "gatekeeperUrl",
            "searchServerUrl"
        ]);
        await gatekeeper.connect({ url: gatekeeperUrl });
        search = await SearchClient.create({ url: searchServerUrl });

        const wallet = new WalletChrome();
        const walletData = await wallet.loadWallet();

        let response = await chrome.runtime.sendMessage({
            action: "GET_PASSPHRASE",
        });
        const pass = response?.passphrase || "";

        if (pass) {
            let res = await initWithPassphrase(pass, "unlock");
            if (res) {
                return;
            }
            await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
        }

        if (isEncryptedWallet(walletData)) {
            setWalletAction("decrypt");
        } else {
            setWalletAction("encrypt");
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

        await initWithPassphrase(pass, "unlock");
    }

    useEffect(() => {
        initialiseWallet();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function initWithPassphrase(passphrase: string, intent: InitIntent) {
        try {
            if (intent === "unlock") {
                const keymaster = await makeKeymaster(passphrase);
                await keymaster.loadWallet();
                keymasterRef.current = keymaster;
            } else if (intent === "setup") {
                const walletChromePlain = new WalletChrome();
                const kmPlain = new Keymaster({
                    gatekeeper,
                    wallet: walletChromePlain,
                    cipher,
                    search,
                    passphrase,
                });

                const existing = await walletChromePlain.loadWallet();
                if (existing) {
                    await kmPlain.loadWallet();
                } else {
                    await kmPlain.newWallet();
                }

                const v1Plain = await walletChromePlain.loadWallet() as WalletFile;
                const walletEnc = new WalletWebEncrypted(walletChromePlain, passphrase);
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
                await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });
                setPendingMnemonic("");
            }

            await chrome.runtime.sendMessage({ action: "STORE_PASSPHRASE", passphrase });

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

    async function makeKeymaster(passphrase: string) {
        const walletChrome = new WalletChrome();
        const walletEnc = new WalletWebEncrypted(walletChrome, passphrase);
        const walletCache = new WalletCache(walletEnc);

        return new Keymaster({
            gatekeeper,
            wallet: walletCache,
            cipher,
            search,
            passphrase,
        });
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
