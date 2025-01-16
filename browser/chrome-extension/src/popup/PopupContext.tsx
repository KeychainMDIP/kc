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
import { AlertColor } from "@mui/material";

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
    snackbar: SnackbarState;
    setError(error: string): void;
    setWarning(warning: string): void;
    manifest: any;
    resolveId: () => Promise<void>;
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
    const [currentDID, setCurrentDID] = useState('');
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

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

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
        const handleMessage = (message, sender, sendResponse) => {
            if (message.action === 'SHOW_POPUP_AUTH') {
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
        if (currentId && pendingAuth) {
            (async () => {
                await setSelectedTab('auth');
                await setChallenge(pendingAuth);
                setPendingAuth(null);
            })();
        }
    }, [currentId, pendingAuth]);

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
            let url: string;
            try {
                let result = await chrome.storage.sync.get(["gatekeeperUrl"]);
                url = result.gatekeeperUrl;
            } catch (error) {
                setError(error.error || error.message || String(error));
            }

            const gatekeeper = new GatekeeperClient();
            await gatekeeper.connect({ url });
            const wallet = new WalletChrome();
            const cipher = new CipherWeb();
            if (!keymasterRef.current) {
                keymasterRef.current = new Keymaster({
                    gatekeeper,
                    wallet,
                    cipher,
                });
            }

            await refreshAll();
        };
        init();
    }, []);

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

    async function forceRefreshAll() {
        await chrome.storage.local.remove([
            "selectedTab",
            "currentId",
            "challenge",
            "registry",
            "heldDID",
        ]);

        await refreshAll();
    }

    async function refreshCurrentDID(cid: string) {
        try {
            const docs = await keymasterRef.current.resolveId(cid);
            setCurrentDID(docs.didDocument.id);
            setManifest(docs.didDocumentData.manifest);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }

    }

    async function refreshAll() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const {
                selectedTab: storedTab,
                currentId: storedCid,
                challenge: storedChallenge,
                registry: storedRegistry,
                heldDID: storedHeldDID,
            } = await chrome.storage.local.get([
                "selectedTab",
                "currentId",
                "challenge",
                "registry",
                "heldDID",
            ]);

            let usedLocal = false;

            if (storedTab) {
                await setSelectedTab(storedTab);
                // tab will always be stored.
                usedLocal = true;
            }

            if (storedCid) {
                await setCurrentId(storedCid);
                setSelectedId(storedCid);
                await refreshCurrentDID(storedCid);
                await refreshHeld();

                const ids = await keymaster.listIds();
                setIdList(ids);
            }

            if (storedChallenge) {
                await setChallenge(storedChallenge);
            }

            if (storedRegistry) {
                await setRegistry(storedRegistry);
            }

            if (storedHeldDID) {
                await setHeldDID(storedHeldDID);
            }

            const regs = await keymaster.listRegistries();
            setRegistries(regs);

            if (!usedLocal) {
                const cid = await keymaster.getCurrentId();
                await setSelectedTab("identities");

                if (cid) {
                    await setCurrentId(cid);
                    setSelectedId(cid);
                    await refreshCurrentDID(cid);
                    await refreshHeld();

                    const ids = await keymaster.listIds();
                    setIdList(ids);
                } else {
                    await setCurrentId("");
                    setSelectedId("");
                    setCurrentDID("");
                    setIdList([]);
                    setManifest(null);
                }
                
                await setHeldDID("");
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function resolveId() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const docs = await keymaster.resolveId(selectedId);
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
        snackbar,
        setError,
        setWarning,
        resolveId,
        refreshAll,
        forceRefreshAll,
        refreshHeld,
        handleSnackbarClose,
        openBrowserTab,
        keymaster: keymasterRef.current,
    };

    return (
        <PopupContext.Provider value={value}>{children}</PopupContext.Provider>
    );
}

export function usePopupContext() {
    const context = useContext(PopupContext);
    if (!context) {
        throw new Error("Failed to get context from PopupContext.Provider");
    }
    return context;
}
