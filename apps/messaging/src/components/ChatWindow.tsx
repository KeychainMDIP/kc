import React, { useMemo, useState, useEffect, useRef } from "react"
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
import { CHAT_SUBJECT } from "../constants";
import WarningModal from "../modals/WarningModal";
import QRCodeModal from "../modals/QRCodeModal";
import GroupDetailsModal, { GroupMemberDisplay } from "../modals/GroupDetailsModal";
import { Buffer } from "buffer";
import SlideInRight from "./transitions/SlideInRight";
import { useColorMode } from "../contexts/ColorModeProvider";
import { addMessagingContact } from "../utils/contacts";
import {
    canUpdateGroupProfile,
    GROUP_PROFILE_PAYLOAD_TYPE,
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
}

type SenderDisplay = {
    name: string
    avatar?: string
    source: "keymaster" | "profile" | "fallback"
}

const UNREAD = "unread"
const GROUP_NOT_FOUND = "Group not found";

const ChatWindow: React.FC = () => {
    const {
        activePeer,
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
        resolveAvatar,
        resolveSenderProfile,
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

    const groupMemberDisplays = useMemo((): GroupMemberDisplay[] => {
        return currentGroupMembers.map(memberDid => {
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
    }, [currentDID, currentGroupMembers, currentId, knownDisplayNameByDid, profileList, senderProfileList]);

    useEffect(() => {
        if (!groupDetailsOpen || !isGroup) {
            return;
        }

        const unresolvedMembers = currentGroupMembers.filter(memberDid =>
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
        currentGroupMembers,
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

    const selectedMemberAlreadyKnown = selectedMember
        ? Object.values(nameList).includes(selectedMember.did)
        : false;
    const selectedMemberCanAdd = !!selectedMember && !selectedMember.isCurrentUser && !selectedMemberAlreadyKnown;
    const memberCountLabel = `${currentGroupMembers.length} ${currentGroupMembers.length === 1 ? "member" : "members"}`;
    const canUpdateActiveGroupAvatar = isGroup && canUpdateGroupProfile(
        currentDID,
        { members: currentGroupMembers.length ? currentGroupMembers : (groupEntry?.members ?? []) }
    );

    const onRemove = () => {
        if (!activePeer) {
            return;
        }
        setRemoveOpen(true);
    };

    const confirmRemove = async () => {
        if (!keymaster || !activePeer) {
            return;
        }
        try {
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
        if (!activePeer || !keymaster) {
            return;
        }

        const selectedGroup = groupList[activePeer];
        if (selectedGroup) {
            setCurrentGroupMembers(selectedGroup.members);
            (async () => {
                try {
                    const group = await keymaster.getGroup(activePeer);
                    if (!group) {
                        setError(GROUP_NOT_FOUND);
                        return;
                    }
                    if (group?.members) {
                        setCurrentGroupMembers(group.members);
                    }

                } catch (err: any) {
                    setError(err);
                }
            })();
        } else {
            setCurrentGroupMembers([]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePeer, groupList, keymaster]);

    useEffect(() => {
        if (!activePeer || !keymaster || !peerDid || !currentDID) {
            return;
        }

        const updates: Array<{ did: string; newTags: string[] }> = [];

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
            if (tags.includes("deleted") || tags.includes("archived")) {
                continue;
            }

            if (!tags.includes(UNREAD)) {
                continue;
            }

            const senderDid = itm.docs?.didDocument?.controller;
            const toDids = itm.message?.to ?? [];

            if (isGroup) {
                if (!payloadGroupId || payloadGroupId !== activePeer) {
                    continue;
                }
                const incoming = senderDid && senderDid !== currentDID && toDids.includes(currentDID);
                const outgoing = senderDid === currentDID;
                if (!incoming && !outgoing) {
                    continue;
                }
            } else {
                if (payloadGroupId) {
                    continue;
                }
                const incoming = senderDid === peerDid && toDids.includes(currentDID);
                if (!incoming) {
                    continue;
                }
            }

            updates.push({ did, newTags: tags.filter(t => t !== UNREAD) });
        }

        if (!updates.length) {
            return;
        }

        (async () => {
            try {
                await Promise.all(updates.map(({ did, newTags }) => keymaster.fileDmail(did, newTags)));
                await refreshInbox();
            } catch (error: any) {
                setError(error);
            }
        })();
    }, [activePeer, peerDid, currentDID, currentGroupMembers, dmailList, groupList, keymaster, refreshInbox, setError]);

    const handleSend = async (text: string) => {
        const messageText = (text ?? pendingText).trim();
        if (!messageText || !keymaster || !activePeer) {
            return;
        }

        try {
            setSending(true)

            const isGroup = groupList[activePeer] !== undefined;
            let recipients: string[] = [];

            if (isGroup) {
                try {
                    const group = await keymaster.getGroup(activePeer);
                    if (!group) {
                        setError(GROUP_NOT_FOUND);
                        return;
                    }
                    recipients = group.members;
                } catch (error: any) {
                    setError(error);
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

            const did = await keymaster.createDmail(dmail, { registry })
            await keymaster.sendDmail(did)

            setPendingText("")
            await refreshInbox()
        } catch (err: any) {
            setError(err)
        } finally {
            setSending(false)
        }
    }

    const openFilePicker = () => {
        if (!activePeer || !keymaster || uploadingImage) {
            return;
        }

        const temp = document.createElement("input");
        temp.type = "file";
        temp.accept = "image/*";
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

            const group = await keymaster.getGroup(activePeer);
            if (!group?.members) {
                setError(GROUP_NOT_FOUND);
                return;
            }

            if (!canUpdateGroupProfile(currentDID, group)) {
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
            const recipients = Array.from(new Set(group.members));
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
            await keymaster.sendDmail(did);

            setGroupList(prev => {
                const existing = prev[activePeer] ?? {
                    name: peerDisplayName,
                    members: group.members,
                };

                return {
                    ...prev,
                    [activePeer]: {
                        ...existing,
                        members: group.members,
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
                        try {
                            const group = await keymaster.getGroup(activePeer);
                            if (!group) {
                                setError(GROUP_NOT_FOUND);
                                return;
                            }
                            recipients = group.members;
                        } catch (error: any) {
                            setError(error);
                        }
                    } else {
                        recipients = [peerDid];
                    }

                    const payload: ChatPayload = {
                        type: "image",
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

                    const did = await keymaster.createDmail(dmail);

                    const ok = await keymaster.addDmailAttachment(did, file.name, buffer);
                    if (!ok) {
                        setError(`Error uploading file: ${file.name}`);
                        setUploadingImage(false);
                        return;
                    }

                    await keymaster.sendDmail(did);
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
                const notDeleted = !itm.tags?.includes("deleted");
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
    }, [activePeer, currentDID, peerDid, currentId, dmailList, groupList, keymaster, getSenderDisplay])

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
                accept="image/*"
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
                            accept="image/*"
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
