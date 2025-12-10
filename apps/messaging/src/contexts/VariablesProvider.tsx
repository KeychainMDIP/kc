import { createContext, Dispatch, ReactNode, SetStateAction, useContext, useState, useRef, useEffect, useCallback } from "react";
import { DmailItem } from "@mdip/keymaster/types";
import { useWalletContext } from "./WalletProvider";
import { useSnackbar } from "./SnackbarProvider";
import { MESSAGING_PROFILE } from "../constants";
import { arraysMatchMembers, convertNamesToDIDs } from "../utils/utils";

const REFRESH_INTERVAL = 5_000;

interface VariablesContextValue {
    currentId: string;
    setCurrentId: Dispatch<SetStateAction<string>>;
    validId: boolean;
    setValidId: Dispatch<SetStateAction<boolean>>;
    currentDID: string;
    setCurrentDID: Dispatch<SetStateAction<string>>;
    registries: string[];
    setRegistries: Dispatch<SetStateAction<string[]>>;
    idList: string[];
    setIdList: Dispatch<SetStateAction<string[]>>;
    heldList: string[];
    setHeldList: Dispatch<SetStateAction<string[]>>;
    schemaList: string[];
    setSchemaList: Dispatch<SetStateAction<string[]>>;
    vaultList: string[];
    setVaultList: Dispatch<SetStateAction<string[]>>;
    groupList: Record<string, string[]>;
    setGroupList: Dispatch<SetStateAction<Record<string, string[]>>>;
    imageList: string[];
    setImageList: Dispatch<SetStateAction<string[]>>;
    documentList: string[];
    setDocumentList: Dispatch<SetStateAction<string[]>>;
    issuedList: string[];
    setIssuedList: Dispatch<SetStateAction<string[]>>;
    dmailList: Record<string, DmailItem>;
    setDmailList: Dispatch<SetStateAction<Record<string, DmailItem>>>;
    aliasName: string;
    setAliasName: Dispatch<SetStateAction<string>>;
    aliasDID: string;
    setAliasDID: Dispatch<SetStateAction<string>>;
    nameList: Record<string, string>;
    setNameList: Dispatch<SetStateAction<Record<string, string>>>;
    nameRegistry: Record<string, string>;
    setNameRegistry: Dispatch<SetStateAction<Record<string, string>>>;
    agentList: string[];
    setAgentList: Dispatch<SetStateAction<string[]>>;
    profileList: Record<string, { avatar?: string; name?: string }>;
    setProfileList: Dispatch<SetStateAction<Record<string, { avatar?: string; name?: string }>>>;
    pollList: string[];
    setPollList: Dispatch<SetStateAction<string[]>>;
    activePeer: string;
    setActivePeer: Dispatch<SetStateAction<string>>;
    refreshAll: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    refreshNames: () => Promise<void>;
    refreshInbox: () => Promise<void>;
    refreshCurrentID: () => Promise<boolean | undefined>;
}

const VariablesContext = createContext<VariablesContextValue | null>(null);

export function VariablesProvider({ children }: { children: ReactNode }) {
    const [currentId, setCurrentId] = useState<string>("");
    const [validId, setValidId] = useState<boolean>(false);
    const [currentDID, setCurrentDID] = useState<string>("");
    const [idList, setIdList] = useState<string[]>([]);
    const [registries, setRegistries] = useState<string[]>([]);
    const [heldList, setHeldList] = useState<string[]>([]);
    const [nameList, setNameList] = useState<Record<string, string>>({});
    const [nameRegistry, setNameRegistry] = useState<Record<string, string>>({});
    const [agentList, setAgentList] = useState<string[]>([]);
    const [profileList, setProfileList] = useState<Record<string, { avatar?: string; name?: string }>>({});
    const [pollList, setPollList] = useState<string[]>([]);
    const [groupList, setGroupList] = useState<Record<string, string[]>>({});
    const [imageList, setImageList] = useState<string[]>([]);
    const [documentList, setDocumentList] = useState<string[]>([]);
    const [schemaList, setSchemaList] = useState<string[]>([]);
    const [vaultList, setVaultList] = useState<string[]>([]);
    const [issuedList, setIssuedList] = useState<string[]>([]);
    const [aliasName, setAliasName] = useState<string>("");
    const [aliasDID, setAliasDID] = useState<string>("");
    const [dmailList, setDmailList] = useState<Record<string, DmailItem>>({});
    const [activePeer, setActivePeer] = useState<string>("");
    const [namesReady, setNamesReady] = useState<boolean>(false);
    const inboxRefreshingRef = useRef(false);
    const {
        keymaster,
        setManifest,
    } = useWalletContext();
    const { setError } = useSnackbar();

    const avatarCache = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        const refresh = async () => {
            await refreshAll();
        };
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function getProfileName(
        storedAlias: string,
        didDocumentData: Record<string, any>
    ): string {
        const profile = didDocumentData[MESSAGING_PROFILE] as { name?: unknown } | undefined;

        if (!profile || typeof profile.name !== "string") {
            return storedAlias;
        }

        const trimmed = profile.name.trim();
        return trimmed || storedAlias;
    }

    const refreshNames = useCallback(
        async (cid?: string) => {
            if (!keymaster) {
                return;
            }

            let nameList : Record<string, string> = {};
            const registryMap: Record<string, string> = {};
            const profileList: Record<string, { avatar?: string; name?: string }> = {};

            const allNames = await keymaster.listNames();
            const allNamesSorted = Object.fromEntries(
                Object.entries(allNames).sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
            );

            const idNames = await keymaster.listIds();
            const agentAliasList: string[] = [];

            for (const idName of idNames) {
                try {
                    const doc = await keymaster.resolveDID(idName);
                    if (doc.didDocumentData) {
                        const profileName = getProfileName(idName, doc.didDocumentData);
                        agentAliasList.push(profileName);
                        await populateAgentProfile(idName, doc.didDocumentData, profileList);
                    }
                } catch {}
            }

            setIdList([...idNames]);
            setValidId(idNames.includes(cid ?? currentId));

            const schemaList = [];
            const imageList = [];
            const groupList: Record<string, string[]> = {};
            const vaultList = [];
            const pollList = [];
            const documentList = [];

            for (const [name, did] of Object.entries(allNamesSorted)) {
                try {
                    const doc = await keymaster.resolveDID(name);

                    const reg = doc.mdip?.registry;
                    if (reg) {
                        registryMap[name] = reg;
                    }

                    const data = doc.didDocumentData as Record<string, unknown>;

                    if (doc.mdip?.type === 'agent') {
                        const profileName = getProfileName(name, data);

                        nameList[profileName] = did;
                        agentAliasList.push(profileName);

                        await populateAgentProfile(profileName, data, profileList);

                        continue;
                    }

                    // Set after agent to make sure we use the profile name
                    nameList[name] = did;

                    if (data.group) {
                        const group = await keymaster.getGroup(name);
                        if (group?.members) {
                            groupList[name] = group?.members;
                        }
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

            setNameList(nameList);
            setNameRegistry(registryMap);
            setProfileList(profileList);

            const uniqueSortedAgents = [...new Set(agentAliasList)]
                .sort((a, b) => a.localeCompare(b));
            setAgentList(uniqueSortedAgents);

            setGroupList(groupList);
            setSchemaList(schemaList);
            setImageList(imageList);
            setDocumentList(documentList);
            setVaultList(vaultList);
            setPollList(pollList);
            setNamesReady(true);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [keymaster, currentId]
    );

    const refreshInbox = useCallback( async() => {
        if (!keymaster || !namesReady || !currentId) {
            return;
        }

        if (inboxRefreshingRef.current) {
            return;
        }

        inboxRefreshingRef.current = true;
        let needsRefresh = false;

        try {
            const msgs = await keymaster.listDmail();

            let existingGroupMembers = Object.values(groupList);

            for (const [, item] of Object.entries(msgs)) {
                const { sender, to } = item;

                if (sender === currentId) {
                    continue;
                }

                if (to.length === 1) {
                    const senderExists = Object.keys(nameList).includes(sender);

                    if (!senderExists) {
                        try {
                            const name = sender.slice(-20);
                            await keymaster.addName(name, sender);
                            needsRefresh = true;
                        } catch {}
                    }
                } else if (to.length > 1) {
                    let groupExists = false;
                    for (const members of existingGroupMembers) {
                        if (arraysMatchMembers(convertNamesToDIDs(members, nameList), convertNamesToDIDs(to, nameList))) {
                            groupExists = true;
                        }
                    }

                    if (!groupExists) {
                        try {
                            const groupDID = await keymaster.createGroup("");

                            const groupName = groupDID.slice(-20);
                            await keymaster.addName(groupName, groupDID);

                            for (const memberDID of to) {
                                try {
                                    await keymaster.addGroupMember(groupName, memberDID);
                                } catch {}
                            }

                            existingGroupMembers.push(to);
                            needsRefresh = true;
                        } catch {}
                    }
                }
            }

            setDmailList(prev =>
                JSON.stringify(prev) === JSON.stringify(msgs) ? prev : msgs
            );

            if (needsRefresh) {
                await refreshNames();
            }
        } catch (err: any) {
            setError(err);
        } finally {
            inboxRefreshingRef.current = false;
        }
    }, [keymaster, currentId, namesReady, nameList, groupList, refreshNames, setError]);

    useEffect(() => {
        if (!keymaster || !namesReady) {
            return;
        }

        const refresh = async () => {
            try {
                await keymaster.refreshNotices();
                await refreshInbox();
            } catch {}
        }

        void refresh();

        const interval = setInterval(() => {
            if (!keymaster) {
                return;
            }
            void refresh();
        }, REFRESH_INTERVAL);

        return () => clearInterval(interval);
    }, [keymaster, namesReady, refreshInbox]);

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
        } catch (error: any) {
            setError(error);
        }
    }

    async function resolveAvatar(assetDid: string): Promise<string | null> {
        if (!assetDid || !keymaster) {
            return null;
        }

        if (avatarCache.current.has(assetDid)) {
            return avatarCache.current.get(assetDid)!;
        }

        try {
            const imageAsset = await keymaster.getImage(assetDid);

            if (!imageAsset || !imageAsset.data) {
                return null;
            }

            const mimeType = imageAsset.type || 'image/png';
            const raw: any = imageAsset.data as any;
            const dataPart: BlobPart = raw?.buffer ? new Uint8Array(raw.buffer, raw.byteOffset ?? 0, raw.byteLength ?? raw.length) : new Uint8Array(raw as ArrayBufferLike);
            const blob = new Blob([dataPart], { type: mimeType });
            const url = URL.createObjectURL(blob);

            avatarCache.current.set(assetDid, url);
            return url;
        } catch {
            return null;
        }
    }

    async function populateAgentProfile(
        name: string,
        didDocumentData: Record<string, any>,
        profileList: Record<string, { avatar?: string; name?: string }>
    ): Promise<void> {
        const profile = didDocumentData[MESSAGING_PROFILE] as { avatar?: string; name?: string } | undefined;
        if (!profile) {
            return;
        }

        const entry: { avatar?: string; name?: string } = {
            ...(profileList[name] ?? {}),
        };

        if (profile.name) {
            entry.name = profile.name;
        }

        if (profile.avatar) {
            const blobUrl = await resolveAvatar(profile.avatar);
            if (blobUrl) {
                entry.avatar = blobUrl;
            }
        }

        if (entry.name || entry.avatar) {
            profileList[name] = entry;
        }
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
        setCurrentId(cid);
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
        setProfileList({});
        setHeldList([]);
        setVaultList([]);
        setPollList([]);
        setAliasName("");
        setAliasDID("");
        setNamesReady(false);
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
            setRegistries(regs);
        } catch (error: any) {
            setError(error);
        }

        try {
            await refreshCurrentID();
        } catch (error: any) {
            setError(error);
        }
    }


    const value: VariablesContextValue = {
        currentId,
        setCurrentId,
        validId,
        setValidId,
        currentDID,
        setCurrentDID,
        registries,
        setRegistries,
        idList,
        setIdList,
        heldList,
        setHeldList,
        groupList,
        setGroupList,
        imageList,
        setImageList,
        documentList,
        setDocumentList,
        schemaList,
        setSchemaList,
        vaultList,
        setVaultList,
        issuedList,
        setIssuedList,
        aliasName,
        setAliasName,
        aliasDID,
        setAliasDID,
        nameList,
        setNameList,
        nameRegistry,
        setNameRegistry,
        agentList,
        setAgentList,
        profileList,
        setProfileList,
        pollList,
        setPollList,
        dmailList,
        setDmailList,
        activePeer,
        setActivePeer,
        refreshAll,
        refreshHeld,
        refreshNames,
        refreshInbox,
        refreshCurrentID,
    }

    return (
        <VariablesContext.Provider value={value}>
            {children}
        </VariablesContext.Provider>
    );
}

export function useVariablesContext() {
    const ctx = useContext(VariablesContext);
    if (!ctx) {
        throw new Error('useVariablesContext must be used within VariablesProvider');
    }
    return ctx;
}
