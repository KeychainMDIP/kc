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
    openBrowser: openBrowserValues | undefined;
    setOpenBrowser: Dispatch<SetStateAction<openBrowserValues | undefined>> | undefined;
    openBrowserWindow: (options: openBrowserValues) => void;
    handleCopyDID: (did: string) => void;
    refreshAll: () => Promise<void>;
    resetCurrentID: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    refreshNames: () => Promise<void>;
    wipAllStates: () => void;
}

export interface openBrowserValues {
    title?: string;
    did?: string;
    tab?: string;
    subTab?: string;
    contents?: any;
    clearState?: boolean;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider(
    {
        children,
        pendingAuth,
        pendingCredential,
        openBrowser,
        setOpenBrowser,
        browserRefresh,
        setBrowserRefresh,
    }: {
        children: ReactNode,
        pendingAuth?: string,
        pendingCredential?: string,
        openBrowser?: openBrowserValues,
        setOpenBrowser?: Dispatch<SetStateAction<openBrowserValues | undefined>>,
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
        setHeldDID,
        setHeldList,
        setIssuedList,
        setIssuedString,
        setNameList,
        setGroupList,
        setSchemaList,
        setVaultList,
        credentialSubject,
        setCredentialSubject,
        setAgentList,
        setPollList,
        setSelectedIssued,
        setImageList,
        setDocumentList,
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

    async function getValidIds() {
        if (!keymaster) {
            return [];
        }

        const allIds = await keymaster.listIds();
        const valid: string[] = [];

        for (const alias of allIds) {
            try {
                await keymaster.resolveDID(alias);
                valid.push(alias);
            } catch {}
        }

        return valid.sort((a, b) => a.localeCompare(b));
    }

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
        if (!currentId) {
            return;
        }
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
        } else if (pendingCredential && !pendingUsed) {
            (async () => {
                await setSelectedTab("credentials");
                await setHeldDID(pendingCredential);
            })();

            // Prevent credential repopulating after clear on ID change
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
    }, [currentId, pendingAuth, pendingCredential, pendingTab, pendingMessageTab]);

    function openBrowserWindow(options: openBrowserValues) {
        const tab = options.tab ?? "viewer";

        const payload = {
            ...options,
            tab
        };

        if (isBrowser && setOpenBrowser) {
            setOpenBrowser(payload);
            return;
        }

        chrome.runtime.sendMessage({type: "OPEN_BROWSER_WINDOW", options});
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
        if (!keymaster) {
            return;
        }
        try {
            const heldList = await keymaster.listCredentials();
            setHeldList(heldList);
        } catch (error: any) {
            setError(error);
        }
    }

    async function refreshIssued() {
        if (!keymaster) {
            return;
        }
        try {
            const issuedList = await keymaster.listIssued();
            setIssuedList(issuedList);
            setIssuedString("");
        } catch (error: any) {
            setError(error);
        }
    }

    async function refreshNames() {
        if (!keymaster) {
            return;
        }

        const allNames = await keymaster.listNames();
        let nameList : Record<string, string> = {};

        try {
            for (const [alias, did] of Object.entries(allNames)) {
                await keymaster.resolveDID(did);
                nameList[alias] = did;
            }
        } catch {}

        const names = Object.keys(nameList);
        names.sort((a, b) => a.localeCompare(b))

        const agentList = await getValidIds();

        setNameList(nameList);

        const schemaList = [];
        const imageList = [];
        const groupList = [];
        const vaultList = [];
        const pollList = [];
        const documentList = [];

        for (const name of names) {
            try {
                const doc = await keymaster.resolveDID(name);
                const data = doc.didDocumentData as Record<string, unknown>;

                if (doc.mdip?.type === 'agent') {
                    agentList.push(name);
                    continue;
                }

                if (data.group) {
                    groupList.push(name);
                    continue;
                }

                if (data.schema) {
                    schemaList.push(name);
                    continue;
                }

                if (data.image) {
                    imageList.push(name);
                    continue;
                }

                if (data.document) {
                    documentList.push(name);
                    continue;
                }

                if (data.groupVault) {
                    vaultList.push(name);
                    continue;
                }

                if (data.poll) {
                    pollList.push(name);
                    continue;
                }
            }
            catch {}
        }

        const uniqueSortedAgents = [...new Set(agentList)]
            .sort((a, b) => a.localeCompare(b));
        setAgentList(uniqueSortedAgents);

        if (!agentList.includes(credentialSubject)) {
            setCredentialSubject("");
            setCredentialString("");
        }

        setGroupList(groupList);
        setSchemaList(schemaList);

        if (!schemaList.includes(credentialSchema)) {
            setCredentialSchema("");
            setCredentialString("");
        }

        setImageList(imageList);
        setDocumentList(documentList);
        setVaultList(vaultList);
        setPollList(pollList);
    }

    async function resetCurrentID() {
        await chrome.runtime.sendMessage({
            action: "CLEAR_STATE",
            key: "currentId",
        });
        if (setOpenBrowser) {
            setOpenBrowser({
                clearState: true
            });
        }
        await refreshCurrentID();
    }

    async function refreshCurrentDID(cid: string) {
        if (!keymaster) {
            return;
        }
        try {
            const docs = await keymaster.resolveDID(cid);
            if (!docs.didDocument || !docs.didDocument.id) {
                setError("Failed to set current DID and manifest");
                return;
            }
            setCurrentDID(docs.didDocument.id);

            const docData = docs.didDocumentData as {manifest?: Record<string, unknown>};
            setManifest(docData.manifest);
        } catch (error: any) {
            setError(error);
        }
    }

    async function refreshCurrentIDInternal(cid: string) {
        if (!keymaster) {
            return;
        }
        await setCurrentId(cid);
        setSelectedId(cid);
        await refreshCurrentDID(cid);
        await refreshNames();
        await refreshHeld();
        await refreshIssued();

        const ids = await getValidIds();
        setIdList(ids);
    }

    function wipeUserState() {
        resetWalletState();
        resetCredentialState();
        setSelectedId("");
        setCurrentDID("");
        setManifest({});
        setNameList({});
        setSchemaList([]);
        setAgentList([]);
        setHeldList([]);
        setIssuedList([]);
        setIssuedString("");
        setVaultList([]);
        setPollList([]);
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
        if (!keymaster) {
            return;
        }
        try {
            const cid = await keymaster.getCurrentId();
            if (cid) {
                await refreshCurrentIDInternal(cid);
            } else {
                wipeUserState()
            }

            wipeState()
        } catch (error: any) {
            setError(error);
            return false;
        }

        return true;
    }

    async function refreshStored() {
        if (isBrowser || !keymaster) {
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

        const ids = await getValidIds();
        setIdList(ids);

        const nameList = await keymaster.listNames();
        setNameList(nameList);

        return true;
    }

    async function refreshAll() {
        if (!keymaster) {
            return;
        }
        try {
            const regs = await keymaster.listRegistries();
            if (Array.isArray(regs)) {
                setRegistries(regs);
            } else {
                setRegistries((regs as { registries: string[] }).registries);
            }

            const usedStored = await refreshStored();
            if (!usedStored) {
                await refreshCurrentID();
            }
        } catch (error: any) {
            setError(error);
        }
    }

    function handleCopyDID(did: string) {
        navigator.clipboard.writeText(did).catch((err) => {
            setError(err.message || String(err));
        });
    }

    const value: UIContextValue = {
        selectedTab,
        setSelectedTab,
        selectedMessageTab,
        setSelectedMessageTab,
        openBrowserWindow,
        openBrowser,
        setOpenBrowser,
        handleCopyDID,
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
