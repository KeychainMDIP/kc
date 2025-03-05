import React, {
    createContext,
    Dispatch,
    ReactNode,
    SetStateAction,
    useContext,
    useEffect,
    useState
} from "react";
import { useWalletContext } from "./WalletProvider";
import { useAuthContext } from "./AuthContext";
import { useCredentialsContext } from "./CredentialsProvider";
import { useMessageContext} from "./MessageContext";
import { useThemeContext } from "./ContextProviders";

export enum RefreshMode {
    NONE = 'NONE',
    WALLET = 'WALLET',
    THEME = 'THEME',
}

interface UIContextValue {
    selectedTab: string;
    setSelectedTab: (value: string) => Promise<void>;
    selectedMessageTab: string;
    setSelectedMessageTab: (value: string) => Promise<void>;
    jsonViewerOptions: openJSONViewerOptions | null;
    setJsonViewerOptions: Dispatch<SetStateAction<openJSONViewerOptions | null>>,
    openJSONViewer: (options: openJSONViewerOptions) => void;
    refreshAll: () => Promise<void>;
    resetCurrentID: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    refreshNames: () => Promise<void>;
    wipAllStates: () => void;
}

export interface openJSONViewerOptions {
    title: string;
    did: string;
    tab?: string;
    subTab?: string;
    contents?: any;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider(
    {
        children,
        pendingAuth,
        jsonViewerOptions,
        setJsonViewerOptions,
        browserRefresh,
        setBrowserRefresh,
    }: {
        children: ReactNode,
        pendingAuth?: string,
        jsonViewerOptions?: openJSONViewerOptions,
        setJsonViewerOptions?: Dispatch<SetStateAction<openJSONViewerOptions | null>>,
        browserRefresh?: RefreshMode,
        setBrowserRefresh?: Dispatch<SetStateAction<RefreshMode>>,
    }) {
    const [pendingTab, setPendingTab] = useState<string | null>(null);
    const [pendingMessageTab, setPendingMessageTab] = useState<string | null>(null);
    const [selectedTab, setSelectedTabState] = useState<string>("identities");
    const [selectedMessageTab, setSelectedMessageTabState] = useState<string>("receive");
    const [pendingUsed, setPendingUsed] = useState<boolean>(false);

    const {
        currentId,
        isBrowser,
        setCurrentId,
        setCurrentDID,
        setIdList,
        keymaster,
        setError,
        storeState,
        setManifest,
        setSelectedId,
        setRegistries,
        resetWalletState,
        refreshWalletStored,
        refreshFlag,
        reloadBrowserWallet,
    } = useWalletContext();
    const {
        setResponse,
        setCallback,
        setChallenge,
        setDisableSendResponse,
        refreshAuthStored,
    } = useAuthContext();
    const {
        credentialSchema,
        setCredentialSchema,
        setCredentialString,
        setCredentialDID,
        setHeldList,
        setIssuedList,
        setIssuedString,
        setNameList,
        setGroupList,
        setSchemaList,
        agentList,
        credentialSubject,
        setCredentialSubject,
        setAgentList,
        setSelectedIssued,
        setIssuedStringOriginal,
        setIssuedEdit,
        resetCredentialState,
        refreshCredentialsStored,
    } = useCredentialsContext();
    const {
        refreshMessageStored
    } = useMessageContext();
    const {
        updateThemeFromStorage,
    } = useThemeContext();

    useEffect(() => {
        const refresh = async () => {
            await reloadBrowserWallet();
            await refreshAll();
        };
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshFlag]);

    useEffect(() => {
        if (!setBrowserRefresh || browserRefresh === RefreshMode.NONE) {
            return;
        }

        const refresh = async () => {
            if (browserRefresh === RefreshMode.WALLET) {
                await reloadBrowserWallet();
                await refreshAll();
            } else if (browserRefresh === RefreshMode.THEME) {
                updateThemeFromStorage();
            }
            setBrowserRefresh(RefreshMode.NONE);
        };
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [browserRefresh]);

    useEffect(() => {
        if (!currentId) return;
        if (pendingAuth && !pendingUsed) {
            (async () => {
                await setSelectedTab("auth");
                await setChallenge(pendingAuth);
                await setResponse("");
                await setCallback("");
                await setDisableSendResponse(true);
            })();

            // Prevent challenge repopulating after clear on ID change
            setPendingUsed(true);
        } else if (pendingTab) {
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

    function openJSONViewer(options: openJSONViewerOptions) {
        const contentsString = options.contents ? JSON.stringify(options.contents, null, 4) : null;
        const tab = options.tab ?? "viewer";
        const payload = {
            ...options,
            tab
        };

        if (isBrowser) {
            setJsonViewerOptions(payload);
            return;
        }

        const titleEncoded = encodeURIComponent(options.title);
        const didEncoded = encodeURIComponent(options.did);
        let url = `browser.html?tab=${tab}&title=${titleEncoded}&did=${didEncoded}`;

        if (options.subTab) {
            url += `&subTab=${options.subTab}`;
        }

        if (options.contents) {
            const jsonEncoded = encodeURIComponent(contentsString);
            url += `&doc=${jsonEncoded}`;
        }

        chrome.tabs.query({ url: chrome.runtime.getURL("browser.html") + "*" }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                chrome.tabs.create({ url });
                return;
            }

            const existingTabId = tabs[0].id;

            chrome.tabs.sendMessage(
                existingTabId,
                { type: "PING_JSON_VIEWER" },
                (response) => {
                    if (chrome.runtime.lastError || !response?.ack) {
                        chrome.tabs.create({ url });
                        return;
                    }

                    chrome.tabs.sendMessage(existingTabId, {
                        type: "LOAD_JSON",
                        payload
                    });

                    chrome.tabs.update(existingTabId, { active: true });
                }
            );
        });
    }

    async function setSelectedTab(value: string) {
        setSelectedTabState(value);
        await storeState("selectedTab", value);
    }

    async function setSelectedMessageTab(value: string) {
        setSelectedMessageTabState(value);
        await storeState("selectedMessageTab", value);
    }

    async function refreshHeld() {
        try {
            const heldList = await keymaster.listCredentials();
            setHeldList(heldList);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function refreshIssued() {
        try {
            const issuedList = await keymaster.listIssued();
            setIssuedList(issuedList);
            setIssuedString("");
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function refreshNames() {
        const nameList = await keymaster.listNames();
        const names = Object.keys(nameList);

        setNameList(nameList);

        const groupList = [];

        for (const name of names) {
            try {
                const isGroup = await keymaster.testGroup(name);

                if (isGroup) {
                    groupList.push(name);
                }
            }
            catch {}
        }

        setGroupList(groupList);

        const schemaList = [];

        for (const name of names) {
            try {
                const isSchema = await keymaster.testSchema(name);

                if (isSchema) {
                    schemaList.push(name);
                }
            } catch {}
        }

        setSchemaList(schemaList);

        if (!schemaList.includes(credentialSchema)) {
            setCredentialSchema("");
            setCredentialString("");
        }

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

        if (!agentList.includes(credentialSubject)) {
            setCredentialSubject("");
            setCredentialString("");
        }
    }

    async function resetCurrentID() {
        await chrome.runtime.sendMessage({
            action: "CLEAR_STATE",
            key: "currentId",
        });
        await refreshCurrentID();
    }

    async function refreshCurrentDID(cid: string) {
        try {
            const docs = await keymaster.resolveDID(cid);
            setCurrentDID(docs.didDocument.id);
            setManifest(docs.didDocumentData.manifest);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function refreshCurrentIDInternal(cid: string) {
        await setCurrentId(cid);
        setSelectedId(cid);
        await refreshCurrentDID(cid);
        await refreshNames();
        await refreshHeld();
        await refreshIssued();

        const ids = await keymaster.listIds();
        setIdList(ids);
    }

    function wipeUserState() {
        resetWalletState();
        resetCredentialState();
        setSelectedId("");
        setCurrentDID("");
        setManifest(null);
        setNameList(null);
        setSchemaList([]);
        setAgentList([]);
        setHeldList([]);
        setIssuedList(null);
        setIssuedString("");
    }

    function wipeState() {
        setCredentialDID("");
        setCredentialString("");
        setCredentialSubject("");
        setCredentialSchema("");
        setIssuedString("");
        setSelectedIssued("");
        setIssuedStringOriginal("");
        setIssuedEdit(false);
    }

    function wipAllStates() {
        wipeUserState();
        wipeState();
    }

    async function refreshCurrentID() {
        try {
            const cid = await keymaster.getCurrentId();
            if (cid) {
                await refreshCurrentIDInternal(cid);
            } else {
                wipeUserState()
            }

            wipeState()
        } catch (error) {
            setError(error.error || error.message || String(error));
            return false;
        }

        return true;
    }

    async function refreshStored() {
        if (isBrowser) {
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
        } else {
            // We switched user in the browser so no currentId stored
            const cid = await keymaster.getCurrentId();
            if (cid) {
                await refreshCurrentIDInternal(cid);
            }
        }

        setPendingTab(extensionState.selectedTab);
        setPendingMessageTab(extensionState.selectedMessageTab);

        await refreshAuthStored(extensionState);
        await refreshWalletStored(extensionState);
        await refreshMessageStored(extensionState);
        await refreshCredentialsStored(extensionState);

        if (extensionState.currentId) {
            await refreshCurrentIDInternal(extensionState.currentId);
        }

        const ids = await keymaster.listIds();
        if (ids.length) {
            setIdList(ids);
        }

        const nameList = await keymaster.listNames();
        setNameList(nameList);

        return true;
    }

    async function refreshAll() {
        try {
            const regs = await keymaster.listRegistries();
            if (Array.isArray(regs)) {
                setRegistries(regs);
            } else {
                setRegistries(regs.registries);
            }

            const usedStored = await refreshStored();
            if (!usedStored) {
                await refreshCurrentID();
            }
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    const value: UIContextValue = {
        selectedTab,
        setSelectedTab,
        selectedMessageTab,
        setSelectedMessageTab,
        openJSONViewer,
        jsonViewerOptions,
        setJsonViewerOptions,
        refreshAll,
        resetCurrentID,
        refreshHeld,
        refreshNames,
        wipAllStates,
    }

    return (
        <UIContext.Provider value={value}>
            {children}
        </UIContext.Provider>
    );
}

export function useUIContext() {
    const ctx = useContext(UIContext);
    if (!ctx) {
        throw new Error('useUIContext must be used within UIProvider');
    }
    return ctx;
}
