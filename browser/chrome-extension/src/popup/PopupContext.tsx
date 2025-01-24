import React, {
    createContext,
    useContext,
    useState,
    useEffect,
    useRef,
    ReactNode,
    Dispatch,
    SetStateAction,
} from "react";

import GatekeeperClient from "@mdip/gatekeeper/client";
import Keymaster from "@mdip/keymaster";
import CipherWeb from "@mdip/cipher/web";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCacheAsync from "@mdip/keymaster/wallet/cache-async";
import { AlertColor } from "@mui/material";
import PassphraseModal from "./components/PassphraseModal";

const gatekeeper = new GatekeeperClient();
const cipher = new CipherWeb();

interface SnackbarState {
    open: boolean;
    message: string;
    severity: AlertColor;
}

interface PopupContextValue {
    currentId: string;
    setCurrentId: (value: string) => Promise<void>;
    currentDID: string;
    setCurrentDID: Dispatch<SetStateAction<string>>;
    heldDID: string;
    setHeldDID: (value: string) => Promise<void>;
    heldList: string[];
    challenge: string;
    setChallenge: (value: string) => Promise<void>;
    selectedId: string;
    setSelectedId: Dispatch<SetStateAction<string>>;
    registry: string;
    setRegistry: (value: string) => Promise<void>;
    registries: string[];
    setRegistries: Dispatch<SetStateAction<string[]>>;
    idList: string[];
    setIdList: Dispatch<SetStateAction<string[]>>;
    selectedTab: string;
    setSelectedTab: (value: string) => Promise<void>;
    authDID: string;
    setAuthDID: (value: string) => Promise<void>;
    callback: string;
    setCallback: (value: string) => Promise<void>;
    response: string;
    setResponse: (value: string) => Promise<void>;
    disableSendResponse: boolean;
    setDisableSendResponse: (value: boolean) => Promise<void>;
    snackbar: SnackbarState;
    setError(error: string): void;
    setWarning(warning: string): void;
    manifest: any;
    resolveDID: () => Promise<void>;
    refreshAll: () => Promise<void>;
    forceRefreshAll: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    handleSnackbarClose: () => void;
    openBrowserTab: (title: string, did: string, contents: string) => void;
    keymaster: Keymaster | null;
}

const PopupContext = createContext<PopupContextValue | null>(null);

export function PopupProvider({ children }: { children: ReactNode }) {
    const [currentId, setCurrentIdState] = useState("");
    const [currentDID, setCurrentDID] = useState("");
    const [heldList, setHeldList] = useState<string[]>([]);
    const [heldDID, setHeldDIDState] = useState("");
    const [idList, setIdList] = useState<string[]>([]);
    const [manifest, setManifest] = useState(null);
    const [registry, setRegistryState] = useState("hyperswarm");
    const [registries, setRegistries] = useState<string[]>([]);
    const [challenge, setChallengeState] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [selectedTab, setSelectedTabState] = useState("identities");
    const [pendingAuth, setPendingAuth] = useState<string | null>(null);
    const [pendingTab, setPendingTab] = useState<string | null>(null);
    const [authDID, setAuthDIDState] = useState("");
    const [callback, setCallbackState] = useState("");
    const [response, setResponseState] = useState("");
    const [disableSendResponse, setDisableSendResponseState] = useState(true);
    const [passphraseErrorText, setPassphraseErrorText] = useState(null);
    const [modalAction, setModalAction] = useState(null);
    const [isReady, setIsReady] = useState(false);

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    async function setCallback(value: string) {
        setCallbackState(value);
        await chrome.storage.local.set({ callback: value });
    }

    async function setResponse(value: string) {
        setResponseState(value);
        await chrome.storage.local.set({ response: value });
    }

    async function setDisableSendResponse(value: boolean) {
        setDisableSendResponseState(value);
        await chrome.storage.local.set({ disableSendResponse: value });
    }

    async function setAuthDID(value: string) {
        setAuthDIDState(value);
        await chrome.storage.local.set({ authDID: value });
    }

    async function setSelectedTab(value: string) {
        setSelectedTabState(value);
        await chrome.storage.local.set({ selectedTab: value });
    }

    async function setCurrentId(value: string) {
        setCurrentIdState(value);
        await chrome.storage.local.set({ currentId: value });
    }

    async function setChallenge(value: string) {
        setChallengeState(value);
        await chrome.storage.local.set({ challenge: value });
    }

    async function setRegistry(value: string) {
        setRegistryState(value);
        await chrome.storage.local.set({ registry: value });
    }

    async function setHeldDID(value: string) {
        setHeldDIDState(value);
        await chrome.storage.local.set({ heldDID: value });
    }

    useEffect(() => {
        const handleMessage = (message, _, sendResponse) => {
            if (message.action === "SHOW_POPUP_AUTH") {
                setPendingAuth(message.challenge);
                sendResponse({ success: true });
            }
        };
        chrome.runtime.onMessage.addListener(handleMessage);

        return () => {
            chrome.runtime.onMessage.removeListener(handleMessage);
        };
    }, []);

    useEffect(() => {
        if (!currentId) return;
        if (pendingAuth) {
            (async () => {
                await setSelectedTab("auth");
                await setChallenge(pendingAuth);
                await setResponse("");
                await setCallback("");
                setPendingAuth(null);
                await setDisableSendResponse(true);
            })();
        }
        if (pendingTab) {
            (async () => {
                await setSelectedTab(pendingTab);
                setPendingTab(null);
            })();
        }
    }, [currentId, pendingAuth, pendingTab]);

    const setError = (error: string) => {
        setSnackbar({
            open: true,
            message: error,
            severity: "error",
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

    const keymasterRef = useRef<Keymaster | null>(null);

    useEffect(() => {
        const init = async () => {
            const { gatekeeperUrl } = await chrome.storage.sync.get([
                "gatekeeperUrl",
            ]);
            await gatekeeper.connect({ url: gatekeeperUrl });

            const wallet = new WalletChrome();
            const walletData = await wallet.loadWallet();

            let pass: string;
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

            if (
                walletData &&
                walletData.salt &&
                walletData.iv &&
                walletData.data
            ) {
                setModalAction("decrypt");
            } else {
                keymasterRef.current = new Keymaster({
                    gatekeeper,
                    wallet,
                    cipher,
                });

                if (!walletData) {
                    await keymasterRef.current.newWallet();
                }

                setModalAction("encrypt");
            }
        };
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    async function clearStoredPassphrase() {
        await chrome.runtime.sendMessage({ action: "CLEAR_PASSPHRASE" });
    }

    async function decryptWallet(passphrase: string, modal: boolean = false) {
        const wallet_chrome = new WalletChrome();
        const wallet_enc = new WalletWebEncrypted(wallet_chrome, passphrase);
        const wallet_cache = new WalletCacheAsync(wallet_enc);

        if (modal && modalAction === "encrypt") {
            const walletData = await wallet_chrome.loadWallet();
            await wallet_enc.saveWallet(walletData, true);
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
        });

        setIsReady(true);
        setModalAction(null);
        setPassphraseErrorText(null);

        return true;
    }

    async function handlePassphraseSubmit(passphrase: string) {
        await decryptWallet(passphrase, true);
    }

    async function refreshHeld() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const heldList = await keymaster.listCredentials();
            setHeldList(heldList);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    const deleteValues = [
        "selectedTab",
        "currentId",
        "registry",
        "heldDID",
        "authDID",
        "callback",
        "response",
        "disableSendResponse",
    ];

    const storedValues = [...deleteValues, "challenge"];

    async function forceRefreshAll() {
        await chrome.storage.local.remove(deleteValues);
        await refreshAll();
    }

    async function refreshCurrentDID() {
        try {
            const id = await keymasterRef.current.fetchIdInfo();
            const docs = await keymasterRef.current.resolveDID(id.did);
            setCurrentDID(docs.didDocument.id);
            setManifest(docs.didDocumentData.manifest);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function refreshStored() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        const {
            selectedTab: storedTab,
            currentId: storedCid,
            challenge: storedChallenge,
            registry: storedRegistry,
            heldDID: storedHeldDID,
            authDID: storedAuthDID,
            callback: storedCallback,
            response: storedResponse,
            disableSendResponse: storedDisableSendResponse,
        } = await chrome.storage.local.get(storedValues);

        // Tab always present if store used
        if (!storedTab) {
            return false;
        }

        // If ID not in wallet assume new wallet created externally
        if (storedCid) {
            const wallet = await keymaster.loadWallet();
            if (!Object.keys(wallet.ids).includes(storedCid)) {
                await chrome.storage.local.remove(storedValues);
                return false;
            }
        }

        setPendingTab(storedTab);

        if (storedChallenge) {
            await setChallenge(storedChallenge);
        }

        if (storedRegistry) {
            await setRegistry(storedRegistry);
        }

        if (storedHeldDID) {
            await setHeldDID(storedHeldDID);
        }

        if (storedAuthDID) {
            setAuthDIDState(storedAuthDID);
        }

        if (storedCallback) {
            setCallbackState(storedCallback);
        }

        if (storedResponse) {
            setResponseState(storedResponse);
        }

        if (typeof storedDisableSendResponse !== "undefined") {
            setDisableSendResponseState(storedDisableSendResponse);
        }

        if (storedCid) {
            await setCurrentId(storedCid);
            setSelectedId(storedCid);
            await refreshCurrentDID();
            await refreshHeld();
        }

        const ids = await keymaster.listIds();
        if (ids.length) {
            setIdList(ids);
        }

        return true;
    }

    async function refreshDefault() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        const cid = await keymaster.getCurrentId();

        if (cid) {
            await setCurrentId(cid);
            setSelectedId(cid);
            await refreshCurrentDID();
            await refreshHeld();

            const ids = await keymaster.listIds();
            setIdList(ids);
        } else {
            await setCurrentId("");
            setSelectedId("");
            setCurrentDID("");
            setManifest(null);
            setHeldList([]);
            setIdList([]);
        }

        await setAuthDID("");
        await setCallback("");
        await setResponse("");
        await setDisableSendResponse(true);
        await setHeldDID("");
    }

    async function refreshAll() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const regs = await keymaster.listRegistries();
            setRegistries(regs);

            const usedStored = await refreshStored();
            if (!usedStored) {
                await refreshDefault();
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function resolveDID() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const id = await keymaster.fetchIdInfo();
            const docs = await keymaster.resolveDID(id.did);
            setManifest(docs.didDocumentData.manifest);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    function openBrowserTab(title: string, did: string, contents: string) {
        const newTab = window.open("", "_blank");
        if (newTab) {
            newTab.document.write(`
                <html lang="en-US">
                    <head>
                        <title>${title}</title>
                    </head>
                    <body>
                        <h1>${title}</h1>
                        <p style="font-family: Courier,monospace;">${did}</p>
                        <textarea style="width: 100%; height: 100%" readOnly>
                            ${contents}
                        </textarea>
                    </body>
                </html>
            `);
            newTab.document.close();
        } else {
            setError("Unable to open new tab.");
        }
    }

    const value: PopupContextValue = {
        currentId,
        setCurrentId,
        currentDID,
        setCurrentDID,
        heldDID,
        setHeldDID,
        heldList,
        setChallenge,
        challenge,
        selectedId,
        setSelectedId,
        registry,
        setRegistry,
        registries,
        setRegistries,
        idList,
        manifest,
        setIdList,
        selectedTab,
        setSelectedTab,
        authDID,
        setAuthDID,
        callback,
        setCallback,
        response,
        setResponse,
        disableSendResponse,
        setDisableSendResponse,
        snackbar,
        setError,
        setWarning,
        resolveDID,
        refreshAll,
        forceRefreshAll,
        refreshHeld,
        handleSnackbarClose,
        openBrowserTab,
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
                onSubmit={handlePassphraseSubmit}
                encrypt={modalAction === "encrypt"}
            />

            {isReady && (
                <PopupContext.Provider value={value}>
                    {children}
                </PopupContext.Provider>
            )}
        </>
    );
}

export function usePopupContext() {
    const context = useContext(PopupContext);
    if (!context) {
        throw new Error("Failed to get context from PopupContext.Provider");
    }
    return context;
}
