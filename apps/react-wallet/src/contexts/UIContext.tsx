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
import {
    AttachFile,
    Email,
    Image,
    Login,
    PictureAsPdf,
    Token,
} from '@mui/icons-material';
import { useWalletContext } from "./WalletProvider";
import { useVariablesContext } from "./VariablesProvider";
import { useSnackbar } from "./SnackbarProvider";
import WalletWeb from "@mdip/keymaster/wallet/web";

interface UIContextValue {
    selectedTab: string;
    setSelectedTab: Dispatch<SetStateAction<string>>;
    pendingChallenge: string | null;
    setPendingChallenge: Dispatch<SetStateAction<string | null>>;
    pendingSubTab: string | null;
    setPendingSubTab: Dispatch<SetStateAction<string | null>>;
    pendingHeldDID: string | null;
    setPendingHeldDID: Dispatch<SetStateAction<string | null>>;
    openBrowser: openBrowserValues | undefined;
    setOpenBrowser: Dispatch<SetStateAction<openBrowserValues | undefined>>;
    handleCopyDID: (did: string) => void;
    getVaultItemIcon: (name: string, item: any) => React.ReactNode;
    updateManifest: () => Promise<void>;
    refreshAll: () => Promise<void>;
    resetCurrentID: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    refreshNames: () => Promise<void>;
    refreshInbox: () => Promise<void>;
}

export interface openBrowserValues {
    did?: string;
    tab?: string;
    subTab?: string;
    contents?: any;
    clearState?: boolean;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider(
    {
        children
    }: {
        children: ReactNode
    }) {
    const [pendingTab, setPendingTab] = useState<string | null>(null);
    const [pendingChallenge, setPendingChallenge] = useState<string | null>(null);
    const [pendingSubTab, setPendingSubTab] = useState<string | null>(null);
    const [pendingHeldDID, setPendingHeldDID] = useState<string | null>(null);
    const [selectedTab, setSelectedTab] = useState<string>("identities");
    const [openBrowser, setOpenBrowser] = useState<openBrowserValues | undefined>(undefined);

    const {
        keymaster,
        refreshFlag,
    } = useWalletContext();
    const { setError } = useSnackbar();
    const {
        currentId,
        setCurrentId,
        setCurrentDID,
        setValidId,
        setIdList,
        setUnresolvedIdList,
        setRegistries,
        credentialSchema,
        setCredentialSchema,
        setCredentialString,
        setCredentialDID,
        setHeldList,
        setIssuedList,
        setIssuedString,
        setNameList,
        setNameRegistry,
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
        setAliasName,
        setDmailList,
        setAliasDID,
        setManifest,
    } = useVariablesContext();

    const walletWeb = new WalletWeb();

    useEffect(() => {
        const refresh = async () => {
            await refreshAll();
        };
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!refreshFlag) {
            return;
        }
        const refresh = async () => {
            await refreshAll();
        };
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [refreshFlag]);

    function arraysEqual(a: string[], b: string[]): boolean {
        return a.length === b.length && a.every((v, i) => v === b[i]);
    }

    useEffect(() => {
        const refresh = async () => {
            await refreshAll();
        };
        refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
        if (!keymaster) {
            return;
        }

        const refresh = async () => {
            const data = await walletWeb.loadWallet();
            if (!data) {
                return;
            }
            try {
                await keymaster.refreshNotices();
                await refreshPoll();
                await refreshInbox();
            } catch {}
        }

        refresh();

        const interval = setInterval(async () => {
            if (!keymaster) {
                return;
            }
            await refresh();
        }, 10000);

        return () => clearInterval(interval);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [keymaster]);

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
        const onOpenAuth = (e: Event) => {
            const ce = e as CustomEvent<{ did?: string }>;
            const did = ce.detail?.did;
            setPendingTab('auth');
            if (typeof did === 'string' && did.startsWith('did:')) {
                setPendingChallenge(did);
            }
        };
        window.addEventListener('mdip:openAuth', onOpenAuth as EventListener);
        return () => window.removeEventListener('mdip:openAuth', onOpenAuth as EventListener);
    }, []);

    useEffect(() => {
        const onOpenAccept = (e: Event) => {
            const ce = e as CustomEvent<{ did?: string }>;
            const did = ce.detail?.did;
            setPendingTab('credentials');
            setPendingSubTab('held');
            if (typeof did === 'string' && did.startsWith('did:')) {
                setPendingHeldDID(did);
            }
        };
        window.addEventListener('mdip:openAccept', onOpenAccept as EventListener);
        return () => window.removeEventListener('mdip:openAccept', onOpenAccept as EventListener);
    }, []);

    useEffect(() => {
        if (!currentId) {
            return;
        }
        if (pendingTab) {
            (async () => {
                await setSelectedTab(pendingTab);
                setPendingTab(null);
            })();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentId, pendingTab]);

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
        const registryMap: Record<string, string> = {};

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

                const reg = doc.mdip?.registry;
                if (reg) {
                    registryMap[name] = reg;
                }

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
        setNameRegistry(registryMap);

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
        setOpenBrowser({
            clearState: true
        });
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
        await refreshHeld();
        await refreshCurrentDID(cid);
        await refreshNames(cid);
        await refreshIssued();
    }

    function wipeUserState() {
        setCurrentId("");
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
        setAliasName("");
        setAliasDID("");
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

            await refreshCurrentID();
        } catch (error: any) {
            setError(error);
        }
    }

    function handleCopyDID(did: string) {
        navigator.clipboard.writeText(did).catch((err) => {
            setError(err.message || String(err));
        });
    }

    function getVaultItemIcon(name: string, item: any) {
        const iconStyle = { verticalAlign: 'middle', marginRight: 4 };

        if (!item || !item.type) {
            return <AttachFile style={iconStyle} />;
        }

        if (item.type.startsWith('image/')) {
            return <Image style={iconStyle} />;
        }

        if (item.type === 'application/pdf') {
            return <PictureAsPdf style={iconStyle} />;
        }

        if (item.type === 'application/json') {
            if (name.startsWith('login:')) {
                return <Login style={iconStyle} />;
            }

            if (name === 'dmail') {
                return <Email style={iconStyle} />;
            }

            return <Token style={iconStyle} />;
        }

        // Add more types as needed, e.g. images, PDF, etc.
        return <AttachFile style={iconStyle} />;
    }

    async function updateManifest() {
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

    const value: UIContextValue = {
        selectedTab,
        setSelectedTab,
        pendingChallenge,
        setPendingChallenge,
        pendingSubTab,
        setPendingSubTab,
        pendingHeldDID,
        setPendingHeldDID,
        openBrowser,
        setOpenBrowser,
        handleCopyDID,
        getVaultItemIcon,
        updateManifest,
        refreshAll,
        resetCurrentID,
        refreshHeld,
        refreshNames,
        refreshInbox,
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
