import React, { createContext, ReactNode, useContext, useEffect, useState } from "react";
import { useWalletContext } from "./WalletProvider";
import { useAuthContext } from "./AuthContext";
import { useCredentialsContext } from "./CredentialsProvider";
import { useMessageContext} from "./MessageContext";

interface UIContextValue {
    selectedTab: string;
    setSelectedTab: (value: string) => Promise<void>;
    selectedMessageTab: string;
    setSelectedMessageTab: (value: string) => Promise<void>;
    refreshAll: () => Promise<void>;
    resetCurrentID: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    refreshNames: () => Promise<void>;
    wipAllStates: () => void;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children, isBrowser }: { children: ReactNode, isBrowser: boolean }) {
    const [pendingAuth, setPendingAuth] = useState<string | null>(null);
    const [pendingTab, setPendingTab] = useState<string | null>(null);
    const [pendingMessageTab, setPendingMessageTab] = useState<string | null>(null);
    const [selectedTab, setSelectedTabState] = useState<string>("identities");
    const [selectedMessageTab, setSelectedMessageTabState] = useState<string>("receive");
    const {
        currentId,
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
        setAliasName,
        setAliasDID,
        setHeldList,
        setIssuedList,
        setIssuedString,
        setNameList,
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
        const refresh = async () => {
            if (refreshFlag > 0) {
                await refreshAll();
            }
        };
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshFlag]);

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
        await setAliasName("");
        await setAliasDID("");

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
                wipeState()
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
