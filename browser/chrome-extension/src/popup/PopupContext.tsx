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
import CipherWeb from "@mdip/cipher/web";
import WalletChrome from "@mdip/keymaster/wallet/chrome";
import WalletWebEncrypted from "@mdip/keymaster/wallet/web-enc";
import WalletCache from "@mdip/keymaster/wallet/cache";
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
    currentDID: string;
    heldDID: string;
    setHeldDID: (value: string) => Promise<void>;
    heldList: string[];
    challenge: string;
    setChallenge: (value: string) => Promise<void>;
    selectedId: string;
    setSelectedId: Dispatch<SetStateAction<string>>;
    registry: string;
    setRegistry: (value: string) => Promise<void>;
    messageRegistry: string;
    setMessageRegistry: (value: string) => Promise<void>;
    registries: string[];
    idList: string[];
    selectedTab: string;
    setSelectedTab: (value: string) => Promise<void>;
    selectedMessageTab: string;
    setSelectedMessageTab: (value: string) => Promise<void>;
    authDID: string;
    setAuthDID: (value: string) => Promise<void>;
    callback: string;
    setCallback: (value: string) => Promise<void>;
    response: string;
    setResponse: (value: string) => Promise<void>;
    disableSendResponse: boolean;
    setDisableSendResponse: (value: boolean) => Promise<void>;
    snackbar: SnackbarState;
    nameList: any;
    aliasName: string;
    setAliasName: (value: string) => Promise<void>;
    aliasDID: string;
    setAliasDID: (value: string) => Promise<void>;
    messageDID: string;
    setMessageDID: (value: string) => Promise<void>;
    messageRecipient: string;
    setMessageRecipient: (value: string) => Promise<void>;
    sendMessage: string;
    setSendMessage: (value: string) => Promise<void>;
    receiveMessage: string;
    setReceiveMessage: (value: string) => Promise<void>;
    encryptedDID: string;
    setEncryptedDID: (value: string) => Promise<void>;
    agentList: string[];
    setError(error: string): void;
    setWarning(warning: string): void;
    manifest: any;
    resolveDID: () => Promise<void>;
    refreshAll: () => Promise<void>;
    forceRefreshAll: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    refreshNames: () => Promise<void>;
    handleSnackbarClose: () => void;
    openJSONViewer: (title: string, did: string, contents?: any) => void;
    handleCopyDID: (did: string) => void;
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
    const [registry, setRegistryState] = useState<string>("hyperswarm");
    const [messageRegistry, setMessageRegistryState] =
        useState<string>("hyperswarm");
    const [registries, setRegistries] = useState<string[]>([]);
    const [challenge, setChallengeState] = useState("");
    const [selectedId, setSelectedId] = useState("");
    const [selectedTab, setSelectedTabState] = useState("identities");
    const [selectedMessageTab, setSelectedMessageTabState] =
        useState("receive");
    const [pendingAuth, setPendingAuth] = useState<string | null>(null);
    const [pendingTab, setPendingTab] = useState<string | null>(null);
    const [pendingMessageTab, setPendingMessageTab] = useState<string | null>(
        null,
    );
    const [authDID, setAuthDIDState] = useState("");
    const [callback, setCallbackState] = useState("");
    const [response, setResponseState] = useState("");
    const [disableSendResponse, setDisableSendResponseState] = useState(true);
    const [passphraseErrorText, setPassphraseErrorText] = useState(null);
    const [modalAction, setModalAction] = useState(null);
    const [isReady, setIsReady] = useState(false);
    const [nameList, setNameList] = useState(null);
    const [aliasName, setAliasNameState] = useState("");
    const [aliasDID, setAliasDIDState] = useState("");
    const [messageDID, setMessageDIDState] = useState<string>("");
    const [messageRecipient, setMessageRecipientState] = useState<string>("");
    const [agentList, setAgentList] = useState<string[]>([]);
    const [sendMessage, setSendMessageState] = useState<string>("");
    const [receiveMessage, setReceiveMessageState] = useState<string>("");
    const [encryptedDID, setEncryptedDIDState] = useState<string>("");

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

    async function storeState(key: string, value: string | boolean) {
        await chrome.runtime.sendMessage({
            action: "STORE_STATE",
            key,
            value,
        });
    }

    async function setCallback(value: string) {
        setCallbackState(value);
        await storeState("callback", value);
    }

    async function setResponse(value: string) {
        setResponseState(value);
        await storeState("response", value);
    }

    async function setDisableSendResponse(value: boolean) {
        setDisableSendResponseState(value);
        await storeState("disableSendResponse", value);
    }

    async function setAuthDID(value: string) {
        setAuthDIDState(value);
        await storeState("authDID", value);
    }

    async function setSelectedTab(value: string) {
        setSelectedTabState(value);
        await storeState("selectedTab", value);
    }

    async function setSelectedMessageTab(value: string) {
        setSelectedMessageTabState(value);
        await storeState("selectedMessageTab", value);
    }

    async function setCurrentId(value: string) {
        setCurrentIdState(value);
        await storeState("currentId", value);
    }

    async function setChallenge(value: string) {
        setChallengeState(value);
        await storeState("challenge", value);
    }

    async function setRegistry(value: string) {
        setRegistryState(value);
        await storeState("registry", value);
    }

    async function setMessageRegistry(value: string) {
        setMessageRegistryState(value);
        await storeState("messageRegistry", value);
    }

    async function setHeldDID(value: string) {
        setHeldDIDState(value);
        await storeState("heldDID", value);
    }

    async function setAliasName(value: string) {
        setAliasNameState(value);
        await storeState("aliasName", value);
    }

    async function setAliasDID(value: string) {
        setAliasDIDState(value);
        await storeState("aliasDID", value);
    }

    async function setMessageDID(value: string) {
        setMessageDIDState(value);
        await storeState("messageDID", value);
    }

    async function setMessageRecipient(value: string) {
        setMessageRecipientState(value);
        await storeState("messageRecipient", value);
    }

    async function setSendMessage(value: string) {
        setSendMessageState(value);
        await storeState("sendMessage", value);
    }

    async function setReceiveMessage(value: string) {
        setReceiveMessageState(value);
        await storeState("receiveMessage", value);
    }

    async function setEncryptedDID(value: string) {
        setEncryptedDIDState(value);
        await storeState("encryptedDID", value);
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
        if (pendingMessageTab) {
            (async () => {
                await setSelectedMessageTab(pendingMessageTab);
                setPendingMessageTab(null);
            })();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId, pendingAuth, pendingTab, pendingMessageTab]);

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
        const wallet_cache = new WalletCache(wallet_enc);

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

    async function refreshNames() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        const nameList = await keymaster.listNames();
        const names = Object.keys(nameList);

        setNameList(nameList);
        await setAliasName("");
        await setAliasDID("");

        const agents = await keymaster.listIds();
        for (const name of names) {
            try {
                const isAgent = await keymaster.testAgent(name);
                if (isAgent) {
                    agents.push(name);
                }
            } catch {}
        }

        setAgentList(agents);
    }

    const deleteValues = [
        "selectedTab",
        "currentId",
        "registry",
        "messageRegistry",
        "heldDID",
        "authDID",
        "callback",
        "response",
        "disableSendResponse",
        "aliasName",
        "aliasDID",
        "selectedMessageTab",
        "messageDID",
        "messageRecipient",
        "sendMessage",
        "encryptedDID",
        "receiveMessage",
    ];

    async function forceRefreshAll() {
        for (const key of deleteValues) {
            await chrome.runtime.sendMessage({
                action: "CLEAR_STATE",
                key,
            });
        }
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

        const { extensionState } = await chrome.runtime.sendMessage({
            action: "GET_ALL_STATE",
        });

        // Tab always present if store used
        if (!extensionState.selectedTab) {
            return false;
        }

        if (extensionState.currentId) {
            // If ID not in wallet assume new wallet created externally
            const wallet = await keymaster.loadWallet();
            if (!Object.keys(wallet.ids).includes(extensionState.currentId)) {
                await chrome.runtime.sendMessage({ action: "CLEAR_ALL_STATE" });
                return false;
            }

            await refreshNames();
        }

        setPendingTab(extensionState.selectedTab);
        setPendingMessageTab(extensionState.selectedMessageTab);

        if (extensionState.challenge) {
            setChallengeState(extensionState.challenge);
        }

        if (extensionState.registry) {
            setRegistryState(extensionState.registry);
        }

        if (extensionState.messageRegistry) {
            setMessageRegistryState(extensionState.messageRegistry);
        }

        if (extensionState.heldDID) {
            setHeldDIDState(extensionState.heldDID);
        }

        if (extensionState.authDID) {
            setAuthDIDState(extensionState.authDID);
        }

        if (extensionState.callback) {
            setCallbackState(extensionState.callback);
        }

        if (extensionState.response) {
            setResponseState(extensionState.response);
        }

        if (typeof extensionState.disableSendResponse !== "undefined") {
            setDisableSendResponseState(extensionState.disableSendResponse);
        }

        if (extensionState.currentId) {
            await setCurrentId(extensionState.currentId);
            setSelectedId(extensionState.currentId);
            await refreshCurrentDID();
            await refreshHeld();
        } else {
            const cid = await keymaster.getCurrentId();
            if (cid) {
                await setCurrentId(cid);
                setSelectedId(cid);
                await refreshCurrentDID();
            }
        }

        if (extensionState.aliasName) {
            setAliasNameState(extensionState.aliasName);
        }

        if (extensionState.aliasDID) {
            setAliasDIDState(extensionState.aliasDID);
        }

        if (extensionState.messageDID) {
            setMessageDIDState(extensionState.messageDID);
        }

        if (extensionState.messageRecipient) {
            setMessageRecipientState(extensionState.messageRecipient);
        }

        if (extensionState.sendMessage) {
            setSendMessageState(extensionState.sendMessage);
        }

        if (extensionState.receiveMessage) {
            setReceiveMessageState(extensionState.receiveMessage);
        }

        if (extensionState.encryptedDID) {
            setEncryptedDIDState(extensionState.encryptedDID);
        }

        const ids = await keymaster.listIds();
        if (ids.length) {
            setIdList(ids);
        }

        const nameList = await keymaster.listNames();
        setNameList(nameList);

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
            await refreshNames();
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
        await setAliasName("");
        await setAliasDID("");
        await setEncryptedDID("");
    }

    async function refreshAll() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const regs = await keymaster.listRegistries();
            if (Array.isArray(regs)) {
                setRegistries(regs);
            } else {
                setRegistries(regs.registries);
            }

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

    function openJSONViewer(title: string, did: string, contents?: any) {
        const titleEncoded = encodeURIComponent(title);
        const didEncoded = encodeURIComponent(did);
        let viewerUrl = `chrome-extension://${chrome.runtime.id}/viewer.html?title=${titleEncoded}&did=${didEncoded}`;

        if (contents) {
            const contentsString = JSON.stringify(contents, null, 4);
            const jsonEncoded = encodeURIComponent(contentsString);
            viewerUrl += `&json=${jsonEncoded}`;
        }

        window.open(viewerUrl, "_blank");
    }

    function handleCopyDID(did: string) {
        navigator.clipboard.writeText(did).catch((err) => {
            setError(err.message || String(err));
        });
    }

    const value: PopupContextValue = {
        currentId,
        currentDID,
        heldDID,
        setHeldDID,
        heldList,
        setChallenge,
        challenge,
        selectedId,
        setSelectedId,
        registry,
        setRegistry,
        messageRegistry,
        setMessageRegistry,
        registries,
        idList,
        manifest,
        selectedTab,
        setSelectedTab,
        selectedMessageTab,
        setSelectedMessageTab,
        authDID,
        setAuthDID,
        callback,
        setCallback,
        response,
        setResponse,
        disableSendResponse,
        setDisableSendResponse,
        snackbar,
        nameList,
        aliasName,
        setAliasName,
        aliasDID,
        setAliasDID,
        messageDID,
        setMessageDID,
        messageRecipient,
        setMessageRecipient,
        sendMessage,
        setSendMessage,
        receiveMessage,
        setReceiveMessage,
        encryptedDID,
        setEncryptedDID,
        agentList,
        setError,
        setWarning,
        resolveDID,
        refreshAll,
        forceRefreshAll,
        refreshHeld,
        refreshNames,
        handleSnackbarClose,
        openJSONViewer,
        handleCopyDID,
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
