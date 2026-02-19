import { createContext, Dispatch, ReactNode, SetStateAction, useContext, useState, useRef, useEffect, useCallback } from "react";
import { DmailItem } from "@mdip/keymaster/types";
import { useWalletContext } from "./WalletProvider";
import { useSnackbar } from "./SnackbarProvider";
import { CHAT_SUBJECT, MESSAGING_PROFILE } from "../constants";
import { parseChatPayload } from "../utils/utils";

const REFRESH_INTERVAL = 5_000;
const UNREAD = "unread";

interface VariablesContextValue {
    currentId: string;
    setCurrentId: Dispatch<SetStateAction<string>>;
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
    groupList: Record<string, GroupInfo>;
    setGroupList: Dispatch<SetStateAction<Record<string, GroupInfo>>>;
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
    displayNameList: Record<string, string>;
    setDisplayNameList: Dispatch<SetStateAction<Record<string, string>>>;
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
    resolveAvatar: (assetDid: string) => Promise<string | null>,
    refreshAll: () => Promise<void>;
    refreshHeld: () => Promise<void>;
    refreshNames: () => Promise<void>;
    refreshInbox: () => Promise<void>;
    refreshCurrentID: () => Promise<boolean | undefined>;
}

const VariablesContext = createContext<VariablesContextValue | null>(null);

type GroupInfo = {
    name: string;
    members: string[];
};

export function VariablesProvider({ children }: { children: ReactNode }) {
    const [currentId, setCurrentId] = useState<string>("");
    const [currentDID, setCurrentDID] = useState<string>("");
    const [idList, setIdList] = useState<string[]>([]);
    const [registries, setRegistries] = useState<string[]>([]);
    const [heldList, setHeldList] = useState<string[]>([]);
    const [nameList, setNameList] = useState<Record<string, string>>({});
    const [displayNameList, setDisplayNameList] = useState<Record<string, string>>({});
    const [nameRegistry, setNameRegistry] = useState<Record<string, string>>({});
    const [agentList, setAgentList] = useState<string[]>([]);
    const [profileList, setProfileList] = useState<Record<string, { avatar?: string; name?: string }>>({});
    const [pollList, setPollList] = useState<string[]>([]);
    const [groupList, setGroupList] = useState<Record<string, GroupInfo>>({});
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
        async () => {
            if (!keymaster) {
                return;
            }

            const canonical = await keymaster.listNames({ includeIDs: true });
            const canonicalSorted = Object.fromEntries(
                Object.entries(canonical).sort(([a], [b]) => a.localeCompare(b))
            ) as Record<string, string>;

            const registryMap: Record<string, string> = {};
            const profileListLocal: Record<string, { avatar?: string; name?: string }> = {};
            const canonicalAliasToDid: Record<string, string> = { ...canonicalSorted };

            const displayNameToDid: Record<string, string> = {};
            const didToDisplay: Record<string, string> = {};
            const agentDisplayNames: string[] = [];

            const idNames = await keymaster.listIds();
            setIdList([...idNames]);

            const schemaList = [];
            const imageList = [];
            const groupListLocal: Record<string, GroupInfo> = {};
            const vaultList = [];
            const pollList = [];
            const documentList = [];

            const allocDisplayName = (baseName: string, did: string) => {
                let display = baseName;

                if (displayNameToDid[display] && displayNameToDid[display] !== did) {
                    let suffix = 2;
                    while (displayNameToDid[`${baseName} #${suffix}`] && displayNameToDid[`${baseName} #${suffix}`] !== did) {
                        suffix++;
                    }
                    display = `${baseName} #${suffix}`;
                }

                displayNameToDid[display] = did;
                didToDisplay[did] = display;
                agentDisplayNames.push(display);
                return display;
            };

            for (const idName of idNames) {
                try {
                    const doc = await keymaster.resolveDID(idName);
                    if (doc.mdip?.type !== "agent") {
                        continue;
                    }

                    const did = doc.didDocument?.id;
                    if (!did) {
                        continue;
                    }

                    if (doc.didDocumentData) {
                        const base = getProfileName(idName, doc.didDocumentData);
                        const display = didToDisplay[did] ?? allocDisplayName(base, did);
                        canonicalAliasToDid[idName] = did;
                        await populateAgentProfile(display, doc.didDocumentData, profileListLocal);
                    }
                } catch {}
            }

            for (const [alias, did] of Object.entries(canonicalSorted)) {
                try {
                    const doc = await keymaster.resolveDID(alias);

                    const reg = doc.mdip?.registry;
                    if (reg) {
                        registryMap[alias] = reg;
                    }

                    const data = doc.didDocumentData as Record<string, unknown>;

                    if (doc.mdip?.type === "agent") {
                        const base = getProfileName(alias, data);

                        const display = didToDisplay[did] ?? allocDisplayName(base, did);
                        canonicalAliasToDid[alias] = did;

                        await populateAgentProfile(display, data, profileListLocal);
                        continue;
                    }

                    displayNameToDid[alias] = did;
                    canonicalAliasToDid[alias] = did;

                    if (data.group) {
                        const group = await keymaster.getGroup(alias);
                        if (group?.members) {
                            const name = typeof group.name === "string" && group.name.trim()
                                ? group.name.trim()
                                : alias;
                            groupListLocal[did] = { name, members: group.members };
                        }
                        continue;
                    }

                    if (data.schema) {
                        schemaList.push(alias);
                        continue;
                    }

                    if (data.image) {
                        imageList.push(alias);
                        continue;
                    }

                    if (data.document) {
                        documentList.push(alias);
                        continue;
                    }

                    if (data.groupVault) {
                        vaultList.push(alias);
                        continue;
                    }

                    if (data.poll) {
                        pollList.push(alias);
                        continue;
                    }
                }
                catch {}
            }

            try {
                const ownedGroups = await keymaster.listGroups();
                for (const groupDid of ownedGroups) {
                    if (groupListLocal[groupDid]) {
                        continue;
                    }
                    const group = await keymaster.getGroup(groupDid);
                    if (!group?.members) {
                        continue;
                    }
                    const name = typeof group.name === "string" && group.name.trim()
                        ? group.name.trim()
                        : groupDid;
                    groupListLocal[groupDid] = { name, members: group.members };
                }
            } catch {}

            setNameList(canonicalAliasToDid);
            setDisplayNameList(displayNameToDid);
            setNameRegistry(registryMap);
            setProfileList(profileListLocal);

            const uniqueSortedAgents = [...new Set(agentDisplayNames)]
                .sort((a, b) => a.localeCompare(b));
            setAgentList(uniqueSortedAgents);

            const mergedGroupList: Record<string, GroupInfo> = { ...groupListLocal };
            for (const [groupId, info] of Object.entries(groupList)) {
                if (!mergedGroupList[groupId]) {
                    mergedGroupList[groupId] = info;
                }
            }
            setGroupList(mergedGroupList);
            setSchemaList(schemaList);
            setImageList(imageList);
            setDocumentList(documentList);
            setVaultList(vaultList);
            setPollList(pollList);
            setNamesReady(true);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [keymaster, currentId, groupList]
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
            const filtered: Record<string, DmailItem> = {};
            const updates: Array<{ did: string; tags: string[] }> = [];
            const groupUpdates: Record<string, GroupInfo> = {};
            const knownGroups = new Map(Object.entries(groupList));

            for (const [did, item] of Object.entries(msgs)) {
                if (item.message?.subject !== CHAT_SUBJECT) {
                    continue;
                }

                const tags = item.tags ?? [];
                const payload = parseChatPayload(item.message?.body ?? "");

                if (!payload) {
                    if (tags.includes(UNREAD)) {
                        updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                    }
                    continue;
                }

                const messageText = typeof payload.message === "string" ? payload.message.trim() : "";
                const groupId = typeof payload.groupId === "string" ? payload.groupId.trim() : "";
                const groupName = typeof payload.groupName === "string" ? payload.groupName.trim() : "";
                const toDids = item.message?.to ?? [];
                const isGroupDelivery = toDids.length > 1;

                if (isGroupDelivery) {
                    if (!groupId) {
                        if (tags.includes(UNREAD)) {
                            updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                        }
                        continue;
                    }

                    let groupInfo = groupUpdates[groupId] ?? knownGroups.get(groupId);
                    if (!groupInfo) {
                        try {
                            const group = await keymaster.getGroup(groupId);
                            if (group?.members) {
                                groupInfo = {
                                    name: groupName || groupId,
                                    members: group.members,
                                };
                            }
                        } catch {}
                    }

                    if (!groupInfo) {
                        groupInfo = { name: groupName || groupId, members: [] };
                    } else if (groupName && groupInfo.name !== groupName) {
                        groupInfo = { ...groupInfo, name: groupName };
                    }

                    groupUpdates[groupId] = groupInfo;
                    if (!messageText) {
                        if (tags.includes(UNREAD)) {
                            updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                        }
                        continue;
                    }
                } else if (!messageText) {
                    if (tags.includes(UNREAD)) {
                        updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                    }
                    continue;
                }

                filtered[did] = item;

                if (!isGroupDelivery) {
                    const senderDid = item.docs?.didDocument?.controller;
                    if (senderDid && senderDid !== currentDID) {
                        const alreadyKnown = Object.values(nameList).includes(senderDid);
                        if (!alreadyKnown) {
                            try {
                                const name = senderDid.slice(-20);
                                await keymaster.addName(name, senderDid);
                                needsRefresh = true;
                            } catch {}
                        }
                    }
                }
            }

            if (Object.keys(groupUpdates).length > 0) {
                setGroupList(prev => {
                    let changed = false;
                    const merged = { ...prev };
                    for (const [groupId, info] of Object.entries(groupUpdates)) {
                        const existing = merged[groupId];
                        let membersChanged = false;
                        if (!existing) {
                            membersChanged = true;
                        } else {
                            membersChanged = existing.members.length !== info.members.length
                                || existing.members.some((member, idx) => member !== info.members[idx]);
                        }

                        if (!existing || existing.name !== info.name || membersChanged) {
                            merged[groupId] = info;
                            changed = true;
                        }
                    }
                    return changed ? merged : prev;
                });
            }

            setDmailList(prev =>
                JSON.stringify(prev) === JSON.stringify(filtered) ? prev : filtered
            );

            if (updates.length > 0) {
                await Promise.all(updates.map(({ did, tags }) => keymaster.fileDmail(did, tags)));
            }

            if (needsRefresh) {
                await refreshNames();
            }
        } catch (err: any) {
            setError(err);
        } finally {
            inboxRefreshingRef.current = false;
        }
    }, [keymaster, currentId, currentDID, namesReady, nameList, groupList, refreshNames, setError]);

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
        await refreshNames();
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
        setGroupList({});
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
        displayNameList,
        setDisplayNameList,
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
        resolveAvatar,
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
