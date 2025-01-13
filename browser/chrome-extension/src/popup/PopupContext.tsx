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
    setCurrentId: Dispatch<SetStateAction<string>>;
    heldDID: string;
    setHeldDID: Dispatch<SetStateAction<string>>;
    heldList: string[];
    selectedId: string;
    setSelectedId: Dispatch<SetStateAction<string>>;
    registry: string;
    setRegistry: Dispatch<SetStateAction<string>>;
    registries: string[];
    setRegistries: Dispatch<SetStateAction<string[]>>;
    idList: string[];
    setIdList: Dispatch<SetStateAction<string[]>>;
    selectedTab: string;
    setSelectedTab: Dispatch<SetStateAction<string>>;
    snackbar: SnackbarState;
    setError(error: string): void;
    setWarning(warning: string): void;
    manifest: any;
    resolveId: () => Promise<void>;
    refreshAll: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    handleSnackbarClose: () => void;
    openBrowserTab: (title: string, did: string, contents: string) => void;
    keymaster: Keymaster | null;
}

const PopupContext = createContext<PopupContextValue | null>(null);

export function PopupProvider({ children }: { children: ReactNode }) {
    const [currentId, setCurrentId] = useState("");
    const [heldList, setHeldList] = useState<string[]>([]);
    const [heldDID, setHeldDID] = useState("");
    const [idList, setIdList] = useState<string[]>([]);
    const [manifest, setManifest] = useState(null);
    const [registry, setRegistry] = useState("hyperswarm");
    const [registries, setRegistries] = useState<string[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [selectedTab, setSelectedTab] = useState("identities");

    const [snackbar, setSnackbar] = useState<SnackbarState>({
        open: false,
        message: "",
        severity: "warning",
    });

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
                setError(error.error || error);
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
            setError(error.error || error);
        }
    }

    async function refreshAll() {
        const keymaster = keymasterRef.current;
        if (!keymaster) {
            return;
        }

        try {
            const cid = await keymaster.getCurrentId();
            const regs = await keymaster.listRegistries();

            setRegistries(regs);

            if (cid) {
                setCurrentId(cid);
                setSelectedId(cid);

                const ids = await keymaster.listIds();
                setIdList(ids);

                const docs = await keymaster.resolveId(currentId);
                setManifest(docs.didDocumentData.manifest);

                await refreshHeld();
            } else {
                setCurrentId("");
                setSelectedId("");
                setIdList([]);
                setManifest(null);
            }

            setSelectedTab("identities");
        } catch (error) {
            setError(error.error || error);
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
            setError(error.error || error);
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
        heldDID,
        setHeldDID,
        heldList,
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
