import React, { useCallback, useMemo, useState, useEffect, useRef } from "react"
import {
    ChatContainer,
    ConversationHeader,
    MessageList,
    Message,
    MessageInput,
    Avatar,
} from "@chatscope/chat-ui-kit-react";
import {
    Box,
    IconButton,
    Portal,
    MenuRoot,
    MenuTrigger,
    MenuContent,
    MenuPositioner,
    MenuItem,
} from "@chakra-ui/react";
import { LuEllipsisVertical, LuInfo, LuQrCode, LuTrash2 } from "react-icons/lu";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useWalletContext } from "../contexts/WalletProvider";
import {
    CHAT_PAYLOAD_TYPE_IMAGE,
    CHAT_SUBJECT,
    DMAIL_TAG_ARCHIVED,
    DMAIL_TAG_DELETED,
    DMAIL_TAG_FAILED as FAILED,
    DMAIL_TAG_RETRYING as RETRYING,
    DMAIL_TAG_SENT,
    DMAIL_TAG_UNREAD as UNREAD,
    GROUP_MEMBERSHIP_ACTION_MEMBER_ADDED,
    GROUP_MEMBERSHIP_PAYLOAD_TYPE,
    GROUP_NOT_FOUND_MESSAGE as GROUP_NOT_FOUND,
    GROUP_PROFILE_PAYLOAD_TYPE,
    IMAGE_FILE_ACCEPT,
} from "../constants";
import WarningModal from "../modals/WarningModal";
import QRCodeModal from "../modals/QRCodeModal";
import GroupDetailsModal, { GroupMemberDisplay } from "../modals/GroupDetailsModal";
import AddGroupMemberModal, { AddGroupMemberOption } from "../modals/AddGroupMemberModal";
import { Buffer } from "buffer";
import SlideInRight from "./transitions/SlideInRight";
import { useColorMode } from "../contexts/ColorModeProvider";
import { addMessagingContact } from "../utils/contacts";
import {
    canUpdateGroupProfile,
    avatarDataUrl,
    formatTime,
    getChatMessageText,
    hasRenderableChatContent,
    isImageChatPayload,
    truncateMiddle,
    parseChatPayload,
    stringifyChatPayload,
    ChatPayload,
} from "../utils/utils";

type MessageModel = {
    message: string
    sender: string
    direction: "incoming" | "outgoing"
    sentTime?: string
    position: "single" | "first" | "normal" | "last"
    type?: "text" | "custom"
    senderDid?: string
    senderName?: string
    senderAvatar?: string
    senderNameSource?: "keymaster" | "profile" | "fallback"
    showSenderName?: boolean
    statusText?: string
    statusTone?: "normal" | "error"
    canRetry?: boolean
}

type SenderDisplay = {
    name: string
    avatar?: string
    source: "keymaster" | "profile" | "fallback"
}

function latestTimestamp(existing?: string, incoming?: string): string | undefined {
    if (!existing) {
        return incoming;
    }
    if (!incoming) {
        return existing;
    }

    const existingMs = Date.parse(existing);
    const incomingMs = Date.parse(incoming);
    const safeExistingMs = Number.isFinite(existingMs) ? existingMs : 0;
    const safeIncomingMs = Number.isFinite(incomingMs) ? incomingMs : 0;
    return safeIncomingMs >= safeExistingMs ? incoming : existing;
}

const ChatWindow: React.FC = () => {
    const {
        activePeer,
        agentList,
        currentId,
        currentDID,
        dmailList,
        nameList,
        displayNameList,
        refreshInbox,
        setActivePeer,
        refreshNames,
        profileList,
        senderProfileList,
        groupList,
        setGroupList,
        messageReceiptList,
        resolveAvatar,
        resolveSenderProfile,
        hideGroup,
        sendReadReceipt,
    } = useVariablesContext();
    const {
        keymaster,
        registry,
    } = useWalletContext();

    const [pendingText, setPendingText] = useState<string>("");
    const [sending, setSending] = useState<boolean>(false);
    const [removeOpen, setRemoveOpen] = useState<boolean>(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [uploadingImage, setUploadingImage] = useState<boolean>(false);
    const [imageViewerSrc, setImageViewerSrc] = useState<string>("");
    const [imageViewerOpen, setImageViewerOpen] = useState<boolean>(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const groupAvatarInputRef = useRef<HTMLInputElement | null>(null);
    const [imageAttachments, setImageAttachments] = useState<Record<string, { name: string; url: string; mime: string }[]>>({});
    const [currentGroupMembers, setCurrentGroupMembers] = useState<string[]>([]);
    const [groupDetailsOpen, setGroupDetailsOpen] = useState<boolean>(false);
    const [addGroupMemberOpen, setAddGroupMemberOpen] = useState<boolean>(false);
    const [addingGroupMember, setAddingGroupMember] = useState<boolean>(false);
    const [selectedMember, setSelectedMember] = useState<GroupMemberDisplay | null>(null);
    const [updatingGroupAvatar, setUpdatingGroupAvatar] = useState<boolean>(false);

    const { setError, setSuccess } = useSnackbar();
    const { colorMode } = useColorMode();

    const lastPeerRef = useRef<string>("");
    useEffect(() => {
        if (activePeer) {
            lastPeerRef.current = activePeer;
        }
    }, [activePeer]);

    const uiPeer = activePeer || lastPeerRef.current;
    const groupEntry = uiPeer ? groupList[uiPeer] : undefined;
    const isGroup = !!groupEntry;
    const peerDid = uiPeer
        ? (isGroup ? uiPeer : (displayNameList[uiPeer] ?? nameList[uiPeer] ?? ""))
        : "";
    const peerDisplayName = isGroup ? (groupEntry?.name ?? uiPeer) : uiPeer;
    const canonicalPeerAlias =
        peerDid
            ? (Object.entries(nameList).find(([, d]) => d === peerDid)?.[0] ?? uiPeer)
            : uiPeer;

    const knownDisplayNameByDid = useMemo(() => {
        const out: Record<string, string> = {};

        for (const [alias, did] of Object.entries(nameList)) {
            if (did && !out[did]) {
                out[did] = alias;
            }
        }

        for (const [displayName, did] of Object.entries(displayNameList)) {
            if (did) {
                out[did] = displayName;
            }
        }

        return out;
    }, [displayNameList, nameList]);

    const getSenderDisplay = useMemo(() => {
        return (senderDid?: string): SenderDisplay => {
            if (!senderDid) {
                return { name: "Unknown sender", source: "fallback" };
            }

            const keymasterName = knownDisplayNameByDid[senderDid];
            if (keymasterName) {
                return { name: keymasterName, source: "keymaster" };
            }

            const senderProfile = senderProfileList[senderDid];
            if (senderProfile?.name) {
                return {
                    name: senderProfile.name,
                    avatar: senderProfile.avatar,
                    source: "profile",
                };
            }

            return { name: truncateMiddle(senderDid, 25), source: "fallback" };
        };
    }, [knownDisplayNameByDid, senderProfileList]);

    const activeGroupMembers = useMemo(() => {
        return Array.from(new Set(currentGroupMembers.length ? currentGroupMembers : (groupEntry?.members ?? [])));
    }, [currentGroupMembers, groupEntry]);

    const groupMemberDisplays = useMemo((): GroupMemberDisplay[] => {
        return activeGroupMembers.map(memberDid => {
            const isCurrentUser = memberDid === currentDID;
            const contactName = knownDisplayNameByDid[memberDid];
            const senderProfile = senderProfileList[memberDid];
            const name = isCurrentUser
                ? currentId
                : contactName ?? senderProfile?.name ?? truncateMiddle(memberDid, 25);

            const avatar = isCurrentUser
                ? (profileList[currentId]?.avatar ?? avatarDataUrl(memberDid))
                : (profileList[contactName ?? ""]?.avatar ?? senderProfile?.avatar ?? avatarDataUrl(memberDid));

            return {
                avatar,
                did: memberDid,
                isCurrentUser,
                name,
            };
        });
    }, [activeGroupMembers, currentDID, currentId, knownDisplayNameByDid, profileList, senderProfileList]);

    const addableGroupMemberOptions = useMemo((): AddGroupMemberOption[] => {
        const memberDids = new Set(activeGroupMembers);
        const seenDids = new Set<string>();
        const options: AddGroupMemberOption[] = [];

        for (const name of agentList) {
            const did = displayNameList[name] ?? nameList[name] ?? "";
            if (!did || did === currentDID || memberDids.has(did) || seenDids.has(did)) {
                continue;
            }

            seenDids.add(did);
            options.push({
                avatar: profileList[name]?.avatar ?? avatarDataUrl(did),
                did,
                name,
            });
        }

        return options.sort((left, right) => left.name.localeCompare(right.name));
    }, [activeGroupMembers, agentList, currentDID, displayNameList, nameList, profileList]);

    useEffect(() => {
        if (!groupDetailsOpen || !isGroup) {
            return;
        }

        const unresolvedMembers = activeGroupMembers.filter(memberDid =>
            memberDid !== currentDID &&
            !knownDisplayNameByDid[memberDid] &&
            !senderProfileList[memberDid]
        );

        if (unresolvedMembers.length === 0) {
            return;
        }

        (async () => {
            try {
                await Promise.all(unresolvedMembers.map(memberDid => resolveSenderProfile(memberDid)));
            } catch (error: any) {
                setError(error);
            }
        })();
    }, [
        currentDID,
        activeGroupMembers,
        groupDetailsOpen,
        isGroup,
        knownDisplayNameByDid,
        resolveSenderProfile,
        senderProfileList,
        setError,
    ]);

    const openGroupDetails = () => {
        if (isGroup) {
            setGroupDetailsOpen(true);
        }
    };

    const handleHeaderDetailsKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openGroupDetails();
        }
    };

    const handleSelectedMemberAdd = async () => {
        if (!keymaster || !selectedMember) {
            return;
        }

        try {
            const { profileName } = await addMessagingContact(keymaster, selectedMember.did, nameList);
            await refreshNames();
            setSuccess(`User ${profileName} added`);
        } catch (error: any) {
            setError(error instanceof Error ? error.message : String(error));
        }
    };

    const handleAddGroupMember = async (option: AddGroupMemberOption) => {
        if (!keymaster || !activePeer || !isGroup || addingGroupMember) {
            return;
        }

        try {
            setAddingGroupMember(true);

            if (!activeGroupMembers.length) {
                setError(GROUP_NOT_FOUND);
                return;
            }

            if (!canUpdateGroupProfile(currentDID, { members: activeGroupMembers })) {
                setError("Only group members can add members");
                return;
            }

            if (activeGroupMembers.includes(option.did)) {
                setError(`${option.name} is already in this group`);
                return;
            }

            const recipients = Array.from(new Set([...activeGroupMembers, option.did]));
            const groupName = groupEntry?.name || peerDisplayName;
            const updatedAt = new Date().toISOString();
            const payload: ChatPayload = {
                type: GROUP_MEMBERSHIP_PAYLOAD_TYPE,
                version: 1,
                groupId: activePeer,
                groupName,
                ...(groupEntry?.avatarDid && groupEntry.avatarUpdatedAt
                    ? {
                        groupAvatar: groupEntry.avatarDid,
                        groupAvatarUpdatedAt: groupEntry.avatarUpdatedAt,
                    }
                    : {}),
                action: GROUP_MEMBERSHIP_ACTION_MEMBER_ADDED,
                memberDid: option.did,
                updatedAt,
            };
            const dmail = {
                to: recipients,
                cc: [],
                subject: CHAT_SUBJECT,
                body: stringifyChatPayload(payload),
            };
            const did = await keymaster.createDmail(dmail, { registry });
            const notice = await keymaster.sendDmail(did);
            if (!notice) {
                await keymaster.fileDmail(did, [FAILED]);
                throw new Error("Group update send failed");
            }

            setGroupList(prev => {
                const existing = prev[activePeer] ?? {
                    name: groupName,
                    members: recipients,
                };
                const nextMembers = Array.from(new Set([...existing.members, option.did]));

                return {
                    ...prev,
                    [activePeer]: {
                        ...existing,
                        name: groupName,
                        members: nextMembers,
                        membersUpdatedAt: latestTimestamp(existing.membersUpdatedAt, updatedAt),
                    },
                };
            });
            setAddGroupMemberOpen(false);
            await refreshInbox();
            setSuccess(`${option.name} added to ${groupName}`);
        } catch (error: any) {
            setError(error);
        } finally {
            setAddingGroupMember(false);
        }
    };

    const selectedMemberAlreadyKnown = selectedMember
        ? Object.values(nameList).includes(selectedMember.did)
        : false;
    const selectedMemberCanAdd = !!selectedMember && !selectedMember.isCurrentUser && !selectedMemberAlreadyKnown;
    const canManageActiveGroup = isGroup && canUpdateGroupProfile(
        currentDID,
        { members: activeGroupMembers }
    );
    const memberCountLabel = `${activeGroupMembers.length} ${activeGroupMembers.length === 1 ? "member" : "members"}`;
    const canUpdateActiveGroupAvatar = canManageActiveGroup;

    const getOutgoingStatus = useCallback((
        did: string,
        tags: string[],
        payload: ChatPayload,
        recipientDids: string[]
    ): Pick<MessageModel, "statusText" | "statusTone" | "canRetry"> => {
        if (tags.includes(RETRYING)) {
            return { statusText: "Retrying", statusTone: "normal" };
        }

        if (tags.includes(FAILED)) {
            return { statusText: "Failed", statusTone: "error", canRetry: true };
        }

        const payloadGroupId = typeof payload.groupId === "string" ? payload.groupId.trim() : "";
        const receipts = messageReceiptList[did] ?? {};

        if (payloadGroupId) {
            const recipients = Array.from(new Set(
                recipientDids.filter(recipientDid => recipientDid && recipientDid !== currentDID)
            ));

            if (recipients.length > 0) {
                const readCount = recipients.filter(recipientDid => !!receipts[recipientDid]?.readAt).length;
                const deliveredCount = recipients.filter(recipientDid =>
                    !!receipts[recipientDid]?.deliveredAt || !!receipts[recipientDid]?.readAt
                ).length;

                if (readCount > 0) {
                    return { statusText: `Read ${readCount}/${recipients.length}`, statusTone: "normal" };
                }

                if (deliveredCount > 0) {
                    return { statusText: `Delivered ${deliveredCount}/${recipients.length}`, statusTone: "normal" };
                }
            }
        } else {
            const recipientDid = recipientDids.find(candidateDid => candidateDid !== currentDID) ?? "";
            const receipt = recipientDid ? receipts[recipientDid] : undefined;

            if (receipt?.readAt) {
                return { statusText: "Read", statusTone: "normal" };
            }

            if (receipt?.deliveredAt) {
                return { statusText: "Delivered", statusTone: "normal" };
            }
        }

        if (tags.includes(DMAIL_TAG_SENT)) {
            return { statusText: "Sent", statusTone: "normal" };
        }

        return {};
    }, [currentDID, messageReceiptList]);

    const onRemove = () => {
        if (!activePeer) {
            return;
        }
        setRemoveOpen(true);
    };

    const confirmRemove = async () => {
        if (!activePeer) {
            return;
        }
        try {
            if (isGroup) {
                hideGroup(activePeer);
                setActivePeer("");
                return;
            }

            if (!keymaster) {
                return;
            }

            await keymaster.removeName(canonicalPeerAlias);
            setActivePeer("");
            await refreshNames();
        } catch (error: any) {
            setError(error);
        } finally {
            setRemoveOpen(false);
        }
    };

    const onBack = () => {
        setActivePeer("");
    }

    useEffect(() => {
        if (!activePeer) {
            setCurrentGroupMembers([]);
            return;
        }

        const selectedGroup = groupList[activePeer];
        if (selectedGroup) {
            setCurrentGroupMembers(selectedGroup.members);
        } else {
            setCurrentGroupMembers([]);
        }
    }, [activePeer, groupList]);

    useEffect(() => {
        if (!activePeer || !keymaster || !peerDid || !currentDID) {
            return;
        }

        const updates: Array<{ did: string; newTags: string[] }> = [];
        const readReceiptMessageIds: string[] = [];

        for (const [did, itm] of Object.entries(dmailList || {})) {
            const isGroup = groupList[activePeer] !== undefined;

            if (itm.message?.subject !== CHAT_SUBJECT) {
                continue;
            }

            const payload = parseChatPayload(itm.message?.body ?? "");
            if (!payload) {
                continue;
            }

            if (!hasRenderableChatContent(payload)) {
                continue;
            }
            const payloadGroupId = typeof payload.groupId === "string" ? payload.groupId.trim() : "";

            const tags = itm.tags ?? [];
            if (tags.includes(DMAIL_TAG_DELETED) || tags.includes(DMAIL_TAG_ARCHIVED)) {
                continue;
            }

            const senderDid = itm.docs?.didDocument?.controller;
            const toDids = itm.message?.to ?? [];
            let shouldMarkRead = false;
            let shouldSendReadReceipt = false;

            if (isGroup) {
                if (!payloadGroupId || payloadGroupId !== activePeer) {
                    continue;
                }
                const incoming = senderDid && senderDid !== currentDID && toDids.includes(currentDID);
                const outgoing = senderDid === currentDID;
                if (!incoming && !outgoing) {
                    continue;
                }
                if (incoming) {
                    shouldSendReadReceipt = true;
                }
                shouldMarkRead = tags.includes(UNREAD);
            } else {
                if (payloadGroupId) {
                    continue;
                }
                const incoming = senderDid === peerDid && toDids.includes(currentDID);
                if (!incoming) {
                    continue;
                }
                shouldSendReadReceipt = true;
                shouldMarkRead = tags.includes(UNREAD);
            }

            if (shouldSendReadReceipt) {
                readReceiptMessageIds.push(did);
            }

            if (shouldMarkRead) {
                updates.push({ did, newTags: tags.filter(t => t !== UNREAD) });
            }
        }

        if (!updates.length && !readReceiptMessageIds.length) {
            return;
        }

        (async () => {
            try {
                if (updates.length > 0) {
                    await Promise.all(updates.map(({ did, newTags }) => keymaster.fileDmail(did, newTags)));
                }
                if (readReceiptMessageIds.length > 0) {
                    await Promise.allSettled(readReceiptMessageIds.map(did => sendReadReceipt(did)));
                }
                await refreshInbox();
            } catch (error: any) {
                setError(error);
            }
        })();
    }, [activePeer, peerDid, currentDID, currentGroupMembers, dmailList, groupList, keymaster, refreshInbox, sendReadReceipt, setError]);

    const handleSend = async (text: string) => {
        const messageText = (text ?? pendingText).trim();
        if (!messageText || !keymaster || !activePeer) {
            return;
        }

        let dmailDid = "";
        let sent = false;

        try {
            setSending(true)

            const isGroup = groupList[activePeer] !== undefined;
            let recipients: string[] = [];

            if (isGroup) {
                recipients = activeGroupMembers;
                if (recipients.length === 0) {
                    setError(GROUP_NOT_FOUND);
                    return;
                }
            } else {
                recipients = [peerDid];
            }

            const payload: ChatPayload = {
                message: messageText,
            };
            if (isGroup) {
                payload.groupId = activePeer;
            }

            const dmail = {
                to: recipients,
                cc: [],
                subject: CHAT_SUBJECT,
                body: stringifyChatPayload(payload),
            }

            dmailDid = await keymaster.createDmail(dmail, { registry })
            const notice = await keymaster.sendDmail(dmailDid)
            if (!notice) {
                await keymaster.fileDmail(dmailDid, [FAILED]);
                throw new Error("Message send failed");
            }
            sent = true;

            setPendingText("")
            await refreshInbox()
        } catch (err: any) {
            if (dmailDid && !sent) {
                try {
                    await keymaster.fileDmail(dmailDid, [FAILED]);
                    await refreshInbox();
                } catch {}
            }
            setError(err)
        } finally {
            setSending(false)
        }
    }

    const retrySend = async (did: string) => {
        if (!keymaster) {
            return;
        }

        try {
            await keymaster.fileDmail(did, [RETRYING]);
            await refreshInbox();

            const notice = await keymaster.sendDmail(did);
            if (!notice) {
                await keymaster.fileDmail(did, [FAILED]);
                setError("Message send failed");
                await refreshInbox();
                return;
            }

            await refreshInbox();
        } catch (error: any) {
            try {
                await keymaster.fileDmail(did, [FAILED]);
                await refreshInbox();
            } catch {}
            setError(error);
        }
    };

    const openFilePicker = () => {
        if (!activePeer || !keymaster || uploadingImage) {
            return;
        }

        const temp = document.createElement("input");
        temp.type = "file";
        temp.accept = IMAGE_FILE_ACCEPT;
        temp.hidden = true;
        const onTempChange = async (e: Event) => {
            await uploadImageAttachment(e as unknown as React.ChangeEvent<HTMLInputElement>);
            temp.removeEventListener("change", onTempChange);
            if (temp.parentNode) {
                temp.parentNode.removeChild(temp);
            }
        };
        temp.addEventListener("change", onTempChange, { once: true });
        document.body.appendChild(temp);
        temp.click();
    }

    const isImageName = (name: string) => /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(name);

    const guessMime = (name: string) => {
        const ext = name.split(".").pop()?.toLowerCase();
        switch (ext) {
        case "png": return "image/png";
        case "jpg":
        case "jpeg": return "image/jpeg";
        case "gif": return "image/gif";
        case "webp": return "image/webp";
        case "bmp": return "image/bmp";
        case "svg": return "image/svg+xml";
        default: return "application/octet-stream";
        }
    }

    const openGroupAvatarPicker = () => {
        if (!isGroup || updatingGroupAvatar || !groupAvatarInputRef.current) {
            return;
        }

        groupAvatarInputRef.current.click();
    };

    const uploadGroupAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const fileInput = event.target;
        const file = fileInput.files?.[0];

        if (!file || !keymaster || !activePeer || !isGroup) {
            fileInput.value = "";
            return;
        }

        if (!isImageName(file.name)) {
            setError("Please select an image file");
            fileInput.value = "";
            return;
        }

        try {
            setUpdatingGroupAvatar(true);

            if (!activeGroupMembers.length) {
                setError(GROUP_NOT_FOUND);
                return;
            }

            if (!canUpdateGroupProfile(currentDID, { members: activeGroupMembers })) {
                setError("Only group members can update the group avatar");
                return;
            }

            const arrayBuffer = await file.arrayBuffer();
            const assetDid = await keymaster.createImage(Buffer.from(arrayBuffer));
            const avatar = await resolveAvatar(assetDid);
            if (!avatar) {
                throw new Error("Group avatar image could not be loaded");
            }

            const updatedAt = new Date().toISOString();
            const recipients = activeGroupMembers;
            const payload: ChatPayload = {
                type: GROUP_PROFILE_PAYLOAD_TYPE,
                version: 1,
                groupId: activePeer,
                groupAvatar: assetDid,
                updatedAt,
            };

            const dmail = {
                to: recipients,
                cc: [],
                subject: CHAT_SUBJECT,
                body: stringifyChatPayload(payload),
            };

            const did = await keymaster.createDmail(dmail, { registry });
            const notice = await keymaster.sendDmail(did);
            if (!notice) {
                await keymaster.fileDmail(did, [FAILED]);
                throw new Error("Group avatar update send failed");
            }

            setGroupList(prev => {
                const existing = prev[activePeer] ?? {
                    name: peerDisplayName,
                    members: recipients,
                };

                return {
                    ...prev,
                    [activePeer]: {
                        ...existing,
                        members: recipients,
                        avatar,
                        avatarDid: assetDid,
                        avatarUpdatedAt: updatedAt,
                    },
                };
            });

            await refreshInbox();
            setSuccess("Group avatar updated");
        } catch (error: any) {
            setError(error);
        } finally {
            setUpdatingGroupAvatar(false);
            fileInput.value = "";
        }
    };

    const uploadImageAttachment = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!keymaster || !activePeer) {
            return;
        }

        try {
            const fileInput = event.target;
            if (!fileInput.files || fileInput.files.length === 0) {
                return;
            }

            const file = fileInput.files[0];
            fileInput.value = "";

            if (!isImageName(file.name)) {
                setError("Please select an image file");
                return;
            }

            setUploadingImage(true);

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    if (!e.target || !e.target.result) {
                        setError("Unexpected file reader result");
                        setUploadingImage(false);
                        return;
                    }
                    const arrayBuffer = e.target.result;
                    let buffer: Buffer;
                    if (arrayBuffer instanceof ArrayBuffer) {
                        buffer = Buffer.from(arrayBuffer);
                    } else {
                        setError("Unexpected file reader result type");
                        setUploadingImage(false);
                        return;
                    }

                    const isGroup = groupList[activePeer] !== undefined;
                    let recipients: string[] = [];

                    if (isGroup) {
                        recipients = activeGroupMembers;
                        if (recipients.length === 0) {
                            setError(GROUP_NOT_FOUND);
                            return;
                        }
                    } else {
                        recipients = [peerDid];
                    }

                    const payload: ChatPayload = {
                        type: CHAT_PAYLOAD_TYPE_IMAGE,
                    };
                    if (isGroup) {
                        payload.groupId = activePeer;
                    }

                    const dmail = {
                        to: recipients,
                        cc: [],
                        subject: CHAT_SUBJECT,
                        body: stringifyChatPayload(payload),
                    };

                    const did = await keymaster.createDmail(dmail, { registry });

                    const ok = await keymaster.addDmailAttachment(did, file.name, buffer);
                    if (!ok) {
                        await keymaster.removeDmail(did);
                        setError(`Error uploading file: ${file.name}`);
                        setUploadingImage(false);
                        return;
                    }

                    const notice = await keymaster.sendDmail(did);
                    if (!notice) {
                        await keymaster.fileDmail(did, [FAILED]);
                        setError("Message send failed");
                        await refreshInbox();
                        return;
                    }
                    await refreshInbox();
                } catch (err: any) {
                    setError(err);
                } finally {
                    setUploadingImage(false);
                }
            };

            reader.onerror = (err) => {
                setError(`Error uploading file: ${err}`);
                setUploadingImage(false);
            };

            reader.readAsArrayBuffer(file);
        } catch (err: any) {
            setError(err);
            setUploadingImage(false);
        }
    };


    const openImageViewer = (src: string) => {
        setImageViewerSrc(src);
        setImageViewerOpen(true);
    };

    const closeImageViewer = () => {
        setImageViewerOpen(false);
        setImageViewerSrc("");
    };

    const conversation = useMemo(() => {
        if (!activePeer || !currentId || !keymaster) {
            return [] as { did: string; model: MessageModel; date: string }[]
        }

        const isGroup = groupList[activePeer] !== undefined;

        const convo = Object.entries(dmailList || {})
            .reduce((acc, [did, itm]: any) => {
                const notDeleted = !itm.tags?.includes(DMAIL_TAG_DELETED);
                const isChat = itm.message?.subject === CHAT_SUBJECT;

                if (!isChat || !notDeleted) {
                    return acc;
                }

                const payload = parseChatPayload(itm.message?.body ?? "");
                if (!payload) {
                    return acc;
                }

                if (!hasRenderableChatContent(payload)) {
                    return acc;
                }
                const messageText = getChatMessageText(payload);
                const isImage = isImageChatPayload(payload);

                const senderDid = itm.docs?.didDocument?.controller;
                const toDids = itm.message?.to ?? [];
                const ccDids = itm.message?.cc ?? [];

                if (isGroup) {
                    const payloadGroupId = typeof payload.groupId === "string" ? payload.groupId.trim() : "";
                    if (!payloadGroupId || payloadGroupId !== activePeer) {
                        return acc;
                    }

                    const outgoing = senderDid === currentDID;
                    const incoming = !!senderDid && senderDid !== currentDID && toDids.includes(currentDID);
                    if (!outgoing && !incoming) {
                        return acc;
                    }
                } else {
                    const payloadGroupId = typeof payload.groupId === "string" ? payload.groupId.trim() : "";
                    if (payloadGroupId) {
                        return acc;
                    }
                    if (toDids.length > 1) {
                        return acc;
                    }
                    const incoming = senderDid === peerDid && toDids.includes(currentDID);
                    const outgoing = senderDid === currentDID && toDids.includes(peerDid);
                    if (!incoming && !outgoing) {
                        return acc;
                    }
                }

                const senderDisplay = getSenderDisplay(senderDid);
                const direction = senderDid === currentDID || itm.sender === currentId ? "outgoing" : "incoming";
                const status = direction === "outgoing"
                    ? getOutgoingStatus(did, itm.tags ?? [], payload, [...toDids, ...ccDids])
                    : {};
                const model: MessageModel = {
                    message: messageText,
                    sender: senderDisplay.name || itm.sender,
                    direction,
                    sentTime: formatTime(itm.date),
                    position: "single",
                    type: isImage && !messageText ? "custom" : undefined,
                    senderDid,
                    senderName: senderDisplay.name,
                    senderAvatar: senderDisplay.avatar,
                    senderNameSource: senderDisplay.source,
                    showSenderName: false,
                    ...status,
                }
                acc.push({ did, model, date: itm.date });
                return acc;
            }, [] as { did: string; model: MessageModel; date: string }[])
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        if (isGroup) {
            const senderNameDids = new Map<string, Set<string>>();
            for (const item of convo) {
                const { senderDid, senderName } = item.model;
                if (!senderDid || !senderName) {
                    continue;
                }

                const dids = senderNameDids.get(senderName) ?? new Set<string>();
                dids.add(senderDid);
                senderNameDids.set(senderName, dids);
            }

            for (const item of convo) {
                const { senderDid, senderName, senderNameSource } = item.model;
                if (!senderDid || !senderName || senderNameSource !== "profile") {
                    continue;
                }

                if ((senderNameDids.get(senderName)?.size ?? 0) > 1) {
                    item.model.senderName = `${senderName} (${truncateMiddle(senderDid, 18)})`;
                    item.model.sender = item.model.senderName;
                }
            }
        }

        const sameRun = (
            left: { model: MessageModel; } | undefined,
            right: { model: MessageModel; } | undefined
        ) => {
            if (!left || !right) {
                return false;
            }

            if (left.model.direction !== right.model.direction) {
                return false;
            }

            if (!isGroup) {
                return true;
            }

            return left.model.senderDid === right.model.senderDid;
        };

        for (let i = 0; i < convo.length; i++) {
            const samePrev = sameRun(convo[i - 1], convo[i]);
            const sameNext = sameRun(convo[i], convo[i + 1]);

            if (!samePrev && !sameNext) {
                convo[i].model.position = "single";
            } else if (!samePrev) {
                convo[i].model.position = "first";
            } else if (!sameNext) {
                convo[i].model.position = "last";
            } else {
                convo[i].model.position = "normal";
            }

            convo[i].model.showSenderName = isGroup
                && convo[i].model.direction === "incoming"
                && !!convo[i].model.senderName
                && !samePrev;
        }

        return convo;
    }, [activePeer, currentDID, peerDid, currentId, dmailList, groupList, keymaster, getSenderDisplay, getOutgoingStatus])

    useEffect(() => {
        let mounted = true;
        const urlsToRevoke: string[] = [];

        const load = async () => {
            if (!keymaster) return;
            const out: Record<string, { name: string; url: string; mime: string }[]> = {};
            try {
                for (const item of conversation) {
                    const did = item.did;
                    let list: Record<string, any> = {};
                    try {
                        list = await keymaster.listDmailAttachments(did);
                    } catch {
                        list = {};
                    }
                    const names = Object.keys(list || {}).filter(isImageName);
                    if (names.length === 0) continue;

                    const imgs: { name: string; url: string; mime: string }[] = [];
                    for (const name of names) {
                        try {
                            const buf = await keymaster.getDmailAttachment(did, name);
                            if (!buf) {
                                continue;
                            }
                            const mime = guessMime(name);
                            const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf as any);
                            const arrayBuffer = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
                            const blob = new Blob([arrayBuffer], { type: mime });
                            const url = URL.createObjectURL(blob);
                            urlsToRevoke.push(url);
                            imgs.push({ name, url, mime });
                        } catch {}
                    }
                    if (imgs.length > 0) {
                        out[did] = imgs;
                    }
                }
                if (mounted) {
                    setImageAttachments(out);
                } else {
                    urlsToRevoke.forEach(u => URL.revokeObjectURL(u));
                }
            } catch {}
        };

        load();

        return () => {
            mounted = false;
            urlsToRevoke.forEach(u => URL.revokeObjectURL(u));
        };
    }, [conversation, keymaster]);
    const profile = uiPeer ? profileList[uiPeer] : undefined;
    const customAvatarUrl = profile?.avatar;
    const peerAvatar = uiPeer
        ? (isGroup
            ? (groupEntry?.avatar ?? avatarDataUrl(peerDid || peerDisplayName))
            : (customAvatarUrl ?? avatarDataUrl(peerDid || peerDisplayName)))
        : "";

    return (
        <>
            <WarningModal
                isOpen={removeOpen}
                title={isGroup ? "Remove group?" : "Remove user?"}
                warningText={
                    isGroup
                        ? `This will remove "${peerDisplayName}" from your conversations.`
                        : `This will remove "${peerDisplayName}" from your contacts.`
                }
                onSubmit={confirmRemove}
                onClose={() => setRemoveOpen(false)}
            />

            <QRCodeModal
                isOpen={qrOpen}
                onClose={() => setQrOpen(false)}
                did={peerDid}
                name={peerDisplayName}
                userAvatar={peerAvatar}
                title="Contact QR Code"
            />

            <GroupDetailsModal
                isOpen={groupDetailsOpen}
                onClose={() => setGroupDetailsOpen(false)}
                groupAvatar={peerAvatar}
                groupId={peerDid}
                groupName={peerDisplayName}
                members={groupMemberDisplays}
                onMemberSelect={(member) => setSelectedMember(member)}
                onGroupAvatarClick={openGroupAvatarPicker}
                groupAvatarUpdating={updatingGroupAvatar}
                canUpdateGroupAvatar={canUpdateActiveGroupAvatar}
                canAddMember={canManageActiveGroup}
                addMemberDisabled={addingGroupMember}
                addMemberLoading={addingGroupMember}
                onAddMemberClick={() => setAddGroupMemberOpen(true)}
            />

            <AddGroupMemberModal
                isOpen={addGroupMemberOpen}
                onClose={() => setAddGroupMemberOpen(false)}
                options={addableGroupMemberOptions}
                adding={addingGroupMember}
                onSubmit={handleAddGroupMember}
            />

            {selectedMember && (
                <QRCodeModal
                    isOpen={!!selectedMember}
                    onClose={() => setSelectedMember(null)}
                    did={selectedMember.did}
                    name={selectedMember.name}
                    userAvatar={selectedMember.avatar}
                    title="Group Member QR Code"
                    primaryActionLabel={selectedMemberCanAdd ? "Add User" : undefined}
                    onPrimaryAction={selectedMemberCanAdd ? handleSelectedMemberAdd : undefined}
                />
            )}

            <input
                ref={groupAvatarInputRef}
                type="file"
                accept={IMAGE_FILE_ACCEPT}
                hidden
                onChange={uploadGroupAvatar}
            />

            <SlideInRight isOpen={!!activePeer} bg={colorMode === "dark" ? "gray.900" : "white"} bottomOffset={0} zIndex={2200} position="fixed">
                {uiPeer && (
                    <ChatContainer style={{ height: "100%" }}>
                        <ConversationHeader>
                            <ConversationHeader.Back onClick={onBack} />
                            <Avatar
                                src={peerAvatar}
                                name={uiPeer}
                                onClick={isGroup ? openGroupDetails : undefined}
                                style={isGroup ? { cursor: "pointer" } : undefined}
                            />
                            <ConversationHeader.Content
                                userName={isGroup ? (
                                    <Box
                                        as="span"
                                        role="button"
                                        tabIndex={0}
                                        cursor="pointer"
                                        onClick={openGroupDetails}
                                        onKeyDown={handleHeaderDetailsKeyDown}
                                    >
                                        {peerDisplayName}
                                    </Box>
                                ) : peerDisplayName}
                                info={isGroup ? (
                                    <Box
                                        as="span"
                                        role="button"
                                        tabIndex={0}
                                        cursor="pointer"
                                        onClick={openGroupDetails}
                                        onKeyDown={handleHeaderDetailsKeyDown}
                                    >
                                        {memberCountLabel}
                                    </Box>
                                ) : truncateMiddle(peerDid, 25)}
                            />
                            <ConversationHeader.Actions>
                                <MenuRoot closeOnSelect>
                                    <MenuTrigger asChild>
                                        <IconButton
                                            size="sm"
                                            variant="ghost"
                                            _icon={{ w: "5", h: "5" }}
                                        >
                                            <LuEllipsisVertical />
                                        </IconButton>
                                    </MenuTrigger>

                                    <Portal>
                                        <MenuPositioner zIndex={2300}>
                                            <MenuContent zIndex={2300}>
                                                {isGroup && (
                                                    <MenuItem value="details" onSelect={openGroupDetails}>
                                                        <LuInfo style={{ marginRight: 8 }} />
                                                        Details
                                                    </MenuItem>
                                                )}
                                                {!isGroup && (
                                                    <MenuItem value="export" onSelect={() => setQrOpen(true)}>
                                                        <LuQrCode style={{ marginRight: 8 }} />
                                                        Export
                                                    </MenuItem>
                                                )}
                                                <MenuItem value="delete" onSelect={onRemove}>
                                                    <LuTrash2 style={{ marginRight: 8 }} />
                                                    Delete
                                                </MenuItem>
                                            </MenuContent>
                                        </MenuPositioner>
                                    </Portal>
                                </MenuRoot>
                            </ConversationHeader.Actions>
                        </ConversationHeader>

                        <MessageList autoScrollToBottom autoScrollToBottomOnMount>
                            {conversation.map((m) => {
                                const hasImages = !!(imageAttachments[m.did] && imageAttachments[m.did].length > 0);
                                const displayMessage = m.model.message;
                                const isImageOnly = m.model.type === "custom" && displayMessage === "";
                                return (
                                    <Message
                                        key={m.did}
                                        model={{
                                            ...m.model,
                                            message: displayMessage,
                                            type: isImageOnly ? "custom" : undefined,
                                        }}
                                    >
                                        <Message.Header
                                            sender={m.model.showSenderName ? m.model.senderName : undefined}
                                            sentTime={m.model!.sentTime}
                                        />
                                        {(hasImages || isImageOnly) && (
                                            <Message.CustomContent>
                                                <div>
                                                    {hasImages ? (
                                                        imageAttachments[m.did].map(img => (
                                                            <img
                                                                key={img.name}
                                                                src={img.url}
                                                                alt={img.name}
                                                                style={{
                                                                    maxWidth: 240,
                                                                    maxHeight: 240,
                                                                }}
                                                                onClick={() => openImageViewer(img.url)}
                                                            />
                                                        ))
                                                    ) : (
                                                        <span>Image attachment unavailable</span>
                                                    )}
                                                </div>
                                            </Message.CustomContent>
                                        )}
                                        {m.model.direction === "outgoing" && m.model.statusText && (
                                            <Message.Footer>
                                                <Box
                                                    color={m.model.statusTone === "error" ? "red.500" : "gray.500"}
                                                    display="inline-flex"
                                                    gap={2}
                                                    fontSize="xs"
                                                >
                                                    <span>{m.model.statusText}</span>
                                                    {m.model.canRetry && (
                                                        <Box
                                                            as="button"
                                                            color="blue.500"
                                                            fontWeight="medium"
                                                            onClick={() => retrySend(m.did)}
                                                        >
                                                            Retry
                                                        </Box>
                                                    )}
                                                </Box>
                                            </Message.Footer>
                                        )}
                                    </Message>
                                )})}
                        </MessageList>

                        <MessageInput
                            placeholder={`Message ${peerDisplayName}`}
                            value={pendingText}
                            onChange={setPendingText}
                            onSend={handleSend}
                            disabled={sending || uploadingImage}
                            attachButton={true}
                            sendButton={true}
                            onAttachClick={openFilePicker}
                        />

                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={IMAGE_FILE_ACCEPT}
                            hidden
                            onChange={uploadImageAttachment}
                        />
                    </ChatContainer>
                )}
            </SlideInRight>

            {imageViewerOpen && (
                <Box
                    position="fixed"
                    inset={0}
                    zIndex={2400}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    bg="blackAlpha.800"
                    cursor="zoom-out"
                    onClick={closeImageViewer}
                >
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <img src={imageViewerSrc} style={{ maxWidth: "100%", maxHeight: "100%" }} />
                </Box>
            )}
        </>
    )
}

export default ChatWindow;
