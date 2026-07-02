import { createContext, Dispatch, ReactNode, SetStateAction, useContext, useState, useRef, useEffect, useCallback } from "react";
import { DmailItem } from "@mdip/keymaster/types";
import { useWalletContext } from "./WalletProvider";
import { useSnackbar } from "./SnackbarProvider";
import { CHAT_SUBJECT, MESSAGING_PROFILE } from "../constants";
import {
    canUpdateGroupProfile,
    getGroupAvatarDid,
    getMessageReceiptKey,
    getMessageReceiptPayload,
    hasRenderableChatContent,
    isGroupProfilePayload,
    makeUniqueContactAlias,
    MessageReceiptType,
    parseChatPayload,
} from "../utils/utils";
import { sendMessageReceipt } from "../utils/receipts";

const REFRESH_INTERVAL = 5_000;
const UNREAD = "unread";
const SENT = "sent";

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
    messageReceiptList: MessageReceiptList;
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
    senderProfileList: Record<string, SenderProfile>;
    setSenderProfileList: Dispatch<SetStateAction<Record<string, SenderProfile>>>;
    pollList: string[];
    setPollList: Dispatch<SetStateAction<string[]>>;
    activePeer: string;
    setActivePeer: Dispatch<SetStateAction<string>>;
    resolveAvatar: (assetDid: string) => Promise<string | null>,
    resolveSenderProfile: (did: string) => Promise<SenderProfile>;
    sendReadReceipt: (messageId: string) => Promise<void>;
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
    avatar?: string;
    avatarDid?: string;
    avatarUpdatedAt?: string;
};

function timestampMs(value?: string): number {
    if (!value) {
        return 0;
    }

    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function shouldApplyGroupAvatarUpdate(existing?: string, incoming?: string): boolean {
    return timestampMs(incoming) >= timestampMs(existing);
}

export type SenderProfile = {
    did: string;
    name: string;
    avatar?: string;
};

export type MessageReceiptEntry = {
    deliveredAt?: string;
    readAt?: string;
};

export type MessageReceiptList = Record<string, Record<string, MessageReceiptEntry>>;

function mergeReceipt(
    target: MessageReceiptList,
    messageId: string,
    recipientDid: string,
    receiptType: MessageReceiptType,
    at: string
) {
    const byRecipient = target[messageId] ?? {};
    const existing = byRecipient[recipientDid] ?? {};

    if (receiptType === "delivered") {
        if (existing.deliveredAt && timestampMs(existing.deliveredAt) > timestampMs(at)) {
            return;
        }
        byRecipient[recipientDid] = { ...existing, deliveredAt: at };
    } else {
        if (existing.readAt && timestampMs(existing.readAt) > timestampMs(at)) {
            return;
        }
        byRecipient[recipientDid] = { ...existing, readAt: at };
    }

    target[messageId] = byRecipient;
}

function mergeReceiptLists(prev: MessageReceiptList, updates: MessageReceiptList): MessageReceiptList {
    let changed = false;
    const next: MessageReceiptList = { ...prev };

    for (const [messageId, byRecipient] of Object.entries(updates)) {
        const existingByRecipient = next[messageId] ?? {};
        const nextByRecipient = { ...existingByRecipient };
        let messageChanged = false;

        for (const [recipientDid, receipt] of Object.entries(byRecipient)) {
            const existing = nextByRecipient[recipientDid] ?? {};
            const deliveredAt = receipt.deliveredAt && (
                !existing.deliveredAt || timestampMs(receipt.deliveredAt) >= timestampMs(existing.deliveredAt)
            )
                ? receipt.deliveredAt
                : existing.deliveredAt;
            const readAt = receipt.readAt && (
                !existing.readAt || timestampMs(receipt.readAt) >= timestampMs(existing.readAt)
            )
                ? receipt.readAt
                : existing.readAt;

            if (deliveredAt !== existing.deliveredAt || readAt !== existing.readAt) {
                nextByRecipient[recipientDid] = {
                    ...(deliveredAt ? { deliveredAt } : {}),
                    ...(readAt ? { readAt } : {}),
                };
                messageChanged = true;
                changed = true;
            }
        }

        if (messageChanged) {
            next[messageId] = nextByRecipient;
        }
    }

    return changed ? next : prev;
}

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
    const [senderProfileList, setSenderProfileList] = useState<Record<string, SenderProfile>>({});
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
    const [messageReceiptList, setMessageReceiptList] = useState<MessageReceiptList>({});
    const [activePeer, setActivePeer] = useState<string>("");
    const [namesReady, setNamesReady] = useState<boolean>(false);
    const inboxRefreshingRef = useRef(false);
    const {
        keymaster,
        registry,
        setManifest,
    } = useWalletContext();
    const { setError } = useSnackbar();

    const avatarCache = useRef<Map<string, string>>(new Map());
    const senderProfileListRef = useRef<Record<string, SenderProfile>>({});
    const sentReceiptKeysRef = useRef<Set<string>>(new Set());
    const pendingReadReceiptIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        const refresh = async () => {
            await refreshAll();
        };
        void refresh();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        senderProfileListRef.current = senderProfileList;
    }, [senderProfileList]);

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

    const cacheSenderProfile = useCallback((profile: SenderProfile): SenderProfile => {
        const existing = senderProfileListRef.current[profile.did];
        if (existing) {
            return existing;
        }

        const next = { ...senderProfileListRef.current, [profile.did]: profile };
        senderProfileListRef.current = next;
        setSenderProfileList(next);
        return profile;
    }, []);

    const pruneSenderProfilesForKnownDids = useCallback((knownDids: Set<string>) => {
        const next: Record<string, SenderProfile> = {};
        let changed = false;

        for (const [did, profile] of Object.entries(senderProfileListRef.current)) {
            if (knownDids.has(did)) {
                changed = true;
                continue;
            }
            next[did] = profile;
        }

        if (changed) {
            senderProfileListRef.current = next;
            setSenderProfileList(next);
        }
    }, []);

    const resolveAvatar = useCallback(async (assetDid: string): Promise<string | null> => {
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
    }, [keymaster]);

    const resolveSenderProfile = useCallback(async (did: string): Promise<SenderProfile> => {
        const senderDid = did.trim();
        const fallbackName = senderDid.slice(-20) || senderDid;
        const fallbackProfile: SenderProfile = { did: senderDid, name: fallbackName };

        if (!senderDid || !keymaster) {
            return fallbackProfile;
        }

        const cached = senderProfileListRef.current[senderDid];
        if (cached) {
            return cached;
        }

        let profile = fallbackProfile;

        try {
            const senderDoc = await keymaster.resolveDID(senderDid);
            if (senderDoc.mdip?.type === "agent") {
                const data = senderDoc.didDocumentData as Record<string, any> | undefined;
                const name = getProfileName(fallbackName, data ?? {});
                const messagingProfile = data?.[MESSAGING_PROFILE] as { avatar?: unknown } | undefined;
                const avatarDid = typeof messagingProfile?.avatar === "string"
                    ? messagingProfile.avatar.trim()
                    : "";
                const avatar = avatarDid ? await resolveAvatar(avatarDid) : null;

                profile = {
                    did: senderDid,
                    name,
                    ...(avatar ? { avatar } : {}),
                };
            }
        } catch {
            return fallbackProfile;
        }

        return cacheSenderProfile(profile);
    }, [cacheSenderProfile, keymaster, resolveAvatar]);

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
            const resolvedDocs = new Map<string, Awaited<ReturnType<typeof keymaster.resolveDID>>>();
            const profiledAgentDids = new Set<string>();

            const resolveOnce = async (aliasOrDid: string, expectedDid?: string) => {
                const cachedByExpected = expectedDid ? resolvedDocs.get(expectedDid) : undefined;
                if (cachedByExpected) {
                    return cachedByExpected;
                }

                const cachedByInput = resolvedDocs.get(aliasOrDid);
                if (cachedByInput) {
                    return cachedByInput;
                }

                const doc = await keymaster.resolveDID(aliasOrDid);
                const resolvedDid = doc.didDocument?.id ?? expectedDid ?? aliasOrDid;

                resolvedDocs.set(aliasOrDid, doc);
                resolvedDocs.set(resolvedDid, doc);
                if (expectedDid) {
                    resolvedDocs.set(expectedDid, doc);
                }

                return doc;
            };

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

            const processAgent = async (
                alias: string,
                did: string,
                data: Record<string, any>
            ) => {
                const base = getProfileName(alias, data);
                const display = didToDisplay[did] ?? allocDisplayName(base, did);
                canonicalAliasToDid[alias] = did;

                if (!profiledAgentDids.has(did)) {
                    profiledAgentDids.add(did);
                    await populateAgentProfile(display, data, profileListLocal);
                }
            };

            for (const idName of idNames) {
                try {
                    const doc = await resolveOnce(idName, canonicalAliasToDid[idName]);
                    if (doc.mdip?.type !== "agent") {
                        continue;
                    }

                    const did = doc.didDocument?.id;
                    if (!did) {
                        continue;
                    }

                    const data = (doc.didDocumentData ?? {}) as Record<string, any>;
                    await processAgent(idName, did, data);
                } catch {}
            }

            const canonicalEntries = Object.entries(canonicalAliasToDid)
                .sort(([a], [b]) => a.localeCompare(b));

            for (const [alias, expectedDid] of canonicalEntries) {
                try {
                    const doc = await resolveOnce(alias, expectedDid);
                    const did = doc.didDocument?.id ?? expectedDid;
                    if (!did) {
                        continue;
                    }

                    const reg = doc.mdip?.registry;
                    if (reg) {
                        registryMap[alias] = reg;
                    }

                    const data = (doc.didDocumentData ?? {}) as Record<string, any>;

                    if (doc.mdip?.type === "agent") {
                        await processAgent(alias, did, data);
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
            pruneSenderProfilesForKnownDids(new Set(Object.values(canonicalAliasToDid)));

            const uniqueSortedAgents = [...new Set(agentDisplayNames)]
                .sort((a, b) => a.localeCompare(b));
            setAgentList(uniqueSortedAgents);

            const mergedGroupList: Record<string, GroupInfo> = { ...groupListLocal };
            for (const [groupId, info] of Object.entries(groupList)) {
                if (!mergedGroupList[groupId]) {
                    mergedGroupList[groupId] = info;
                } else {
                    mergedGroupList[groupId] = {
                        ...mergedGroupList[groupId],
                        avatar: mergedGroupList[groupId].avatar ?? info.avatar,
                        avatarDid: mergedGroupList[groupId].avatarDid ?? info.avatarDid,
                        avatarUpdatedAt: mergedGroupList[groupId].avatarUpdatedAt ?? info.avatarUpdatedAt,
                    };
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
        [keymaster, currentId, groupList, pruneSenderProfilesForKnownDids]
    );

    const sendReadReceiptForItem = useCallback(async (messageId: string, item: DmailItem) => {
        if (!keymaster || !currentDID) {
            return;
        }

        const clearPending = () => {
            pendingReadReceiptIdsRef.current.delete(messageId);
        };

        if (!item || item.message?.subject !== CHAT_SUBJECT) {
            clearPending();
            return;
        }

        const payload = parseChatPayload(item.message?.body ?? "");
        if (!payload || !hasRenderableChatContent(payload)) {
            clearPending();
            return;
        }

        const senderDid = item.docs?.didDocument?.controller;
        const toDids = item.message?.to ?? [];
        if (!senderDid || senderDid === currentDID || !toDids.includes(currentDID)) {
            clearPending();
            return;
        }

        const receiptKey = getMessageReceiptKey("read", messageId, currentDID);
        if (sentReceiptKeysRef.current.has(receiptKey)) {
            clearPending();
            return;
        }

        pendingReadReceiptIdsRef.current.add(messageId);

        const groupId = typeof payload.groupId === "string" ? payload.groupId.trim() : "";
        const notice = await sendMessageReceipt({
            keymaster,
            registry,
            messageId,
            senderDid,
            recipientDid: currentDID,
            receiptType: "read",
            ...(groupId ? { groupId } : {}),
        });

        if (notice) {
            sentReceiptKeysRef.current.add(receiptKey);
            clearPending();
        }
    }, [currentDID, keymaster, registry]);

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
            const receiptUpdates: MessageReceiptList = {};
            const sentReceiptKeys = new Set(sentReceiptKeysRef.current);
            const knownGroups = new Map(Object.entries(groupList));
            const knownNames = { ...nameList };
            const knownDids = new Set(Object.values(knownNames));
            const senderProfilesToResolve = new Set<string>();

            for (const [did, item] of Object.entries(msgs)) {
                if (item.message?.subject !== CHAT_SUBJECT) {
                    continue;
                }

                const tags = item.tags ?? [];
                const payload = parseChatPayload(item.message?.body ?? "");
                const receipt = getMessageReceiptPayload(payload);

                if (!receipt) {
                    continue;
                }

                const senderDid = item.docs?.didDocument?.controller;
                const receiptKey = getMessageReceiptKey(receipt.receiptType, receipt.messageId, receipt.recipientDid);
                if (senderDid === currentDID && receipt.recipientDid === currentDID && tags.includes(SENT)) {
                    sentReceiptKeys.add(receiptKey);
                }

                if (senderDid === receipt.recipientDid) {
                    const original = msgs[receipt.messageId];
                    const originalSenderDid = original?.docs?.didDocument?.controller;
                    const originalToDids = original?.message?.to ?? [];
                    const originalCcDids = original?.message?.cc ?? [];
                    const originalPayload = parseChatPayload(original?.message?.body ?? "");
                    const originalGroupId = typeof originalPayload?.groupId === "string" ? originalPayload.groupId.trim() : "";
                    const originalRecipients = new Set([...originalToDids, ...originalCcDids]);

                    if (
                        original?.message?.subject === CHAT_SUBJECT &&
                        originalSenderDid === currentDID &&
                        originalRecipients.has(receipt.recipientDid) &&
                        (!receipt.groupId || receipt.groupId === originalGroupId)
                    ) {
                        mergeReceipt(receiptUpdates, receipt.messageId, receipt.recipientDid, receipt.receiptType, receipt.at);
                    }
                }

                if (tags.includes(UNREAD)) {
                    updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                }
            }

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

                const hasRenderableContent = hasRenderableChatContent(payload);
                const groupId = typeof payload.groupId === "string" ? payload.groupId.trim() : "";
                const groupName = typeof payload.groupName === "string" ? payload.groupName.trim() : "";
                const toDids = item.message?.to ?? [];
                const isGroupDelivery = !!groupId || toDids.length > 1;
                const senderDid = item.docs?.didDocument?.controller;
                const receipt = getMessageReceiptPayload(payload);
                const isGroupProfile = isGroupProfilePayload(payload);

                if (receipt) {
                    continue;
                }

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
                        if (isGroupProfile) {
                            if (tags.includes(UNREAD)) {
                                updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                            }
                            continue;
                        }
                        groupInfo = { name: groupName || groupId, members: [] };
                    }

                    const senderCanUpdateGroup = canUpdateGroupProfile(senderDid, groupInfo);

                    if (groupName && groupInfo.name !== groupName && (!isGroupProfile || senderCanUpdateGroup)) {
                        groupInfo = { ...groupInfo, name: groupName };
                    }

                    groupUpdates[groupId] = groupInfo;

                    if (isGroupProfile) {
                        const groupAvatarDid = getGroupAvatarDid(payload);
                        const itemDate = typeof item.date === "string" ? item.date : "";
                        const updatedAt = itemDate || (typeof payload.updatedAt === "string" ? payload.updatedAt.trim() : "");
                        const sameAvatarUpdate = groupInfo.avatarDid === groupAvatarDid && groupInfo.avatarUpdatedAt === updatedAt;

                        if (
                            groupAvatarDid &&
                            senderCanUpdateGroup &&
                            !sameAvatarUpdate &&
                            shouldApplyGroupAvatarUpdate(groupInfo.avatarUpdatedAt, updatedAt)
                        ) {
                            const avatar = await resolveAvatar(groupAvatarDid);
                            if (avatar) {
                                groupUpdates[groupId] = {
                                    ...groupInfo,
                                    avatar,
                                    avatarDid: groupAvatarDid,
                                    avatarUpdatedAt: updatedAt,
                                };
                            }
                        }

                        if (tags.includes(UNREAD)) {
                            updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                        }
                        continue;
                    }

                    if (!hasRenderableContent) {
                        if (tags.includes(UNREAD)) {
                            updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                        }
                        continue;
                    }
                } else if (!hasRenderableContent) {
                    if (tags.includes(UNREAD)) {
                        updates.push({ did, tags: tags.filter(tag => tag !== UNREAD) });
                    }
                    continue;
                }

                filtered[did] = item;

                if (senderDid && senderDid !== currentDID && toDids.includes(currentDID)) {
                    const deliveredKey = getMessageReceiptKey("delivered", did, currentDID);
                    if (!sentReceiptKeys.has(deliveredKey)) {
                        try {
                            const notice = await sendMessageReceipt({
                                keymaster,
                                registry,
                                messageId: did,
                                senderDid,
                                recipientDid: currentDID,
                                receiptType: "delivered",
                                ...(groupId ? { groupId } : {}),
                            });

                            if (notice) {
                                sentReceiptKeys.add(deliveredKey);
                            }
                        } catch {}
                    }
                }

                if (senderDid && senderDid !== currentDID) {
                    const alreadyKnown = knownDids.has(senderDid);
                    if (isGroupDelivery) {
                        if (!alreadyKnown) {
                            senderProfilesToResolve.add(senderDid);
                        }
                    } else if (!alreadyKnown) {
                        try {
                            let name = senderDid.slice(-20);
                            try {
                                const senderDoc = await keymaster.resolveDID(senderDid);
                                const data = senderDoc.didDocumentData as Record<string, any> | undefined;
                                name = getProfileName(name, data ?? {});
                            } catch {}
                            name = makeUniqueContactAlias(name, senderDid, knownNames);
                            await keymaster.addName(name, senderDid);
                            knownNames[name] = senderDid;
                            knownDids.add(senderDid);
                            senderProfilesToResolve.delete(senderDid);
                            needsRefresh = true;
                        } catch {}
                    }
                }
            }

            sentReceiptKeysRef.current = sentReceiptKeys;

            if (Object.keys(receiptUpdates).length > 0) {
                setMessageReceiptList(prev => mergeReceiptLists(prev, receiptUpdates));
            }

            if (Object.keys(groupUpdates).length > 0) {
                setGroupList(prev => {
                    let changed = false;
                    const merged = { ...prev };
                    for (const [groupId, info] of Object.entries(groupUpdates)) {
                        const existing = merged[groupId];
                        const nextInfo: GroupInfo = {
                            ...info,
                            avatar: info.avatar ?? existing?.avatar,
                            avatarDid: info.avatarDid ?? existing?.avatarDid,
                            avatarUpdatedAt: info.avatarUpdatedAt ?? existing?.avatarUpdatedAt,
                        };
                        let membersChanged = false;
                        if (!existing) {
                            membersChanged = true;
                        } else {
                            membersChanged = existing.members.length !== nextInfo.members.length
                                || existing.members.some((member, idx) => member !== nextInfo.members[idx]);
                        }

                        if (
                            !existing ||
                            existing.name !== nextInfo.name ||
                            membersChanged ||
                            existing.avatar !== nextInfo.avatar ||
                            existing.avatarDid !== nextInfo.avatarDid ||
                            existing.avatarUpdatedAt !== nextInfo.avatarUpdatedAt
                        ) {
                            merged[groupId] = nextInfo;
                            changed = true;
                        }
                    }
                    return changed ? merged : prev;
                });
            }

            setDmailList(prev =>
                JSON.stringify(prev) === JSON.stringify(filtered) ? prev : filtered
            );

            const pendingReadReceiptIds = [...pendingReadReceiptIdsRef.current];
            if (pendingReadReceiptIds.length > 0) {
                await Promise.allSettled(
                    pendingReadReceiptIds.map(async messageId => {
                        const item = filtered[messageId];
                        if (!item) {
                            pendingReadReceiptIdsRef.current.delete(messageId);
                            return;
                        }

                        await sendReadReceiptForItem(messageId, item);
                    })
                );
            }

            if (senderProfilesToResolve.size > 0) {
                await Promise.all(
                    [...senderProfilesToResolve].map(senderDid => resolveSenderProfile(senderDid))
                );
            }

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
    }, [keymaster, registry, currentId, currentDID, namesReady, nameList, groupList, refreshNames, resolveAvatar, resolveSenderProfile, sendReadReceiptForItem, setError]);

    const sendReadReceipt = useCallback(async (messageId: string) => {
        const item = dmailList[messageId];
        if (!item) {
            pendingReadReceiptIdsRef.current.delete(messageId);
            return;
        }

        await sendReadReceiptForItem(messageId, item);
    }, [dmailList, sendReadReceiptForItem]);

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
        setDisplayNameList({});
        setNameRegistry({});
        setSchemaList([]);
        setAgentList([]);
        setProfileList({});
        senderProfileListRef.current = {};
        setSenderProfileList({});
        setHeldList([]);
        setVaultList([]);
        setPollList([]);
        setGroupList({});
        setDmailList({});
        setMessageReceiptList({});
        sentReceiptKeysRef.current = new Set();
        pendingReadReceiptIdsRef.current = new Set();
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
        senderProfileList,
        setSenderProfileList,
        pollList,
        setPollList,
        dmailList,
        setDmailList,
        messageReceiptList,
        activePeer,
        setActivePeer,
        resolveAvatar,
        resolveSenderProfile,
        sendReadReceipt,
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
