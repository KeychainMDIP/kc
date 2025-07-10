import React, {
    createContext,
    Dispatch,
    ReactNode,
    SetStateAction,
    useCallback,
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
    refreshInbox: () => Promise<void>;
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
        setValidId,
        setIdList,
        setUnresolvedIdList,
        keymaster,
        setError,
        storeState,
        setManifest,
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
        setUnresolvedList,
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
        setDmailList,
    } = useCredentialsContext();
    const {
        refreshMessageStored
    } = useMessageContext();
    const {
        updateThemeFromStorage,
    } = useThemeContext();

    function arraysEqual(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }

    const refreshInbox = useCallback( async() => {
        if (!keymaster) {
            return;
        }
        try {
            const msgs = await keymaster.listDmail();
            setDmailList(prev =>
                JSON.stringify(prev) === JSON.stringify(msgs) ? prev : msgs
            );
        } catch (err: any) {
            setError(err);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster]);

    const refreshPoll = useCallback(async () => {
        if (!keymaster) {
            return;
        }

        const walletNames = await keymaster.listNames();
        const names = Object.keys(walletNames);
        names.sort((a, b) => a.localeCompare(b));
        const polls: string[] = [];

        for (const name of names) {
            try {
                const doc = await keymaster.resolveDID(name);
                const data = doc.didDocumentData as Record<string, unknown>;

                if (data.poll) {
                    polls.push(name);
                }
            }
            catch {}
        }

        setPollList(prevPolls => {
            if (arraysEqual(prevPolls, polls)) {
                return prevPolls;
            }

            setNameList(prevNames => {
                const extraNames: Record<string, string> = {};
                for (const name of polls) {
                    if (!(name in prevNames)) {
                        extraNames[name] = walletNames[name];
                    }
                }
                return Object.keys(extraNames).length ? { ...prevNames, ...extraNames } : prevNames;
            });

            return polls;
        });

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster]);

    useEffect(() => {
        const interval = setInterval(async () => {
            if (!keymaster) {
                return;
            }

            try {
                await keymaster.refreshNotices();
                await refreshPoll();
                await refreshInbox();
            } catch {}
        }, 10000);

        return () => clearInterval(interval);

    }, [keymaster, refreshPoll, refreshInbox]);

    async function getValidIds() {
        const valid: string[] = [];
        const invalid: string[] = [];

        if (!keymaster) {
            return {valid, invalid};
        }

        const allIds = await keymaster.listIds();
        for (const alias of allIds) {
            try {
                await keymaster.resolveDID(alias);
                valid.push(alias);
            } catch {
                invalid.push(alias);
            }
        }

        return {valid, invalid};
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

    async function refreshNames(cid?: string) {
        if (!keymaster) {
            return;
        }

        let nameList : Record<string, string> = {};
        let unresolvedList : Record<string, string> = {};

        const allNames = await keymaster.listNames();
        const allNamesSorted = Object.fromEntries(
            Object.entries(allNames).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
        );

        const { valid: agentList, invalid } = await getValidIds();

        setIdList([...agentList]);
        setUnresolvedIdList(invalid);
        setValidId(agentList.includes(cid ?? currentId));

        const schemaList = [];
        const imageList = [];
        const groupList = [];
        const vaultList = [];
        const pollList = [];
        const documentList = [];

        for (const [name, did] of Object.entries(allNamesSorted)) {
            try {
                const doc = await keymaster.resolveDID(name);
                nameList[name] = did;
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
            catch {
                unresolvedList[name] = did;
            }
        }

        setNameList(nameList);
        setUnresolvedList(unresolvedList);

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
        await refreshCurrentDID(cid);
        await refreshNames(cid);
        await refreshHeld();
        await refreshIssued();
    }

    function wipeUserState() {
        resetWalletState();
        resetCredentialState();
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
                wipeUserState();
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
            await refreshCurrentIDInternal(extensionState.currentId);
        } else {
            // We switched user in the browser so no currentId stored
            const cid = await keymaster.getCurrentId();
            if (cid) {
                await refreshCurrentIDInternal(cid);
            }
        }

        return true;
    }

    useEffect(() => {
        (async () => {
            try {
                const { extensionState } = await chrome.runtime.sendMessage({
                    action: "GET_ALL_STATE",
                });

                if (extensionState?.selectedTab) {
                    setPendingTab(extensionState.selectedTab);
                }
                if (extensionState?.selectedMessageTab) {
                    setPendingMessageTab(extensionState.selectedMessageTab);
                }

                await refreshAuthStored(extensionState);
                await refreshWalletStored(extensionState);
                await refreshMessageStored(extensionState);
                await refreshCredentialsStored(extensionState);
            } catch {}
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        refreshInbox,
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
