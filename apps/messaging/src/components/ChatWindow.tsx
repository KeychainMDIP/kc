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
    IconButton,
    Portal,
    MenuRoot,
    MenuTrigger,
    MenuContent,
    MenuPositioner,
    MenuItem,
} from "@chakra-ui/react";
import { LuEllipsisVertical, LuQrCode, LuTrash2 } from "react-icons/lu";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useWalletContext } from "../contexts/WalletProvider";
import { CHAT_SUBJECT } from "../constants";
import WarningModal from "../modals/WarningModal";
import QRCodeModal from "../modals/QRCodeModal";
import { Buffer } from "buffer";
import { CloseButton, Box } from "@chakra-ui/react";
import SlideInRight from "./transitions/SlideInRight";
import { useColorMode } from "../contexts/ColorModeProvider";
import {
    avatarDataUrl,
    formatTime,
    truncateMiddle,
    arraysMatchMembers,
} from "../utils/utils";

type MessageModel = {
    message: string
    sender: string
    direction: "incoming" | "outgoing"
    sentTime?: string
    position: "single" | "first" | "normal" | "last"
    type?: "text" | "custom"
}

const UNREAD = "unread"
const IMAGE_PLACEHOLDER = "[image]"
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
        groupList,
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
    const [imageAttachments, setImageAttachments] = useState<Record<string, { name: string; url: string; mime: string }[]>>({});
    const [currentGroupMembers, setCurrentGroupMembers] = useState<string[]>([]);

    const { setError } = useSnackbar();
    const { colorMode } = useColorMode();

    const lastPeerRef = useRef<string>("");
    useEffect(() => {
        if (activePeer) {
            lastPeerRef.current = activePeer;
        }
    }, [activePeer]);

    const uiPeer = activePeer || lastPeerRef.current;
    const peerDid = uiPeer ? (displayNameList[uiPeer] ?? nameList[uiPeer] ?? "") : "";
    const canonicalPeerAlias =
        uiPeer && peerDid
            ? (Object.entries(nameList).find(([, d]) => d === peerDid)?.[0] ?? uiPeer)
            : uiPeer;

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

        const isGroup = Object.keys(groupList).includes(activePeer);
        if (isGroup) {
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
                if (!arraysMatchMembers(toDids, currentGroupMembers)) {
                    continue;
                }
                const incoming = senderDid && senderDid !== currentDID && toDids.includes(currentDID);
                const outgoing = senderDid === currentDID;
                if (!incoming && !outgoing) {
                    continue;
                }
            } else {
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePeer, peerDid, currentDID, currentGroupMembers]);

    const handleSend = async (text: string) => {
        const body = (text ?? pendingText).trim();
        if (!body || !keymaster || !activePeer) {
            return;
        }

        try {
            setSending(true)

            const isGroup = Object.keys(groupList).includes(activePeer);
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

            const dmail = {
                to: recipients,
                cc: [],
                subject: CHAT_SUBJECT,
                body,
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

                    const isGroup = Object.keys(groupList).includes(activePeer);
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

                    const dmail = {
                        to: recipients,
                        cc: [],
                        subject: CHAT_SUBJECT,
                        body: IMAGE_PLACEHOLDER,
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
            return [] as { did: string; model: MessageModel }[]
        }

        const isGroup = Object.keys(groupList).includes(activePeer);

        const convo = Object.entries(dmailList || {})
            .filter(([, itm]: any) => {
                const to = [...(itm.to || [])];
                const notDeleted = !itm.tags?.includes("deleted");
                const isChat = itm.message?.subject === CHAT_SUBJECT;

                if (!isChat || !notDeleted) {
                    return false;
                }

                const senderDid = itm.docs?.didDocument?.controller;
                const toDids = itm.message?.to ?? [];

                if (isGroup) {
                    if (!arraysMatchMembers(toDids, currentGroupMembers)) {
                        return false;
                    }

                    const outgoing = senderDid === currentId;
                    const incoming = senderDid !== currentId && toDids.includes(currentDID);
                    return outgoing || incoming;
                } else {
                    if (to.length > 1) {
                        return false;
                    }
                    const incoming = senderDid === peerDid && toDids.includes(currentDID);
                    const outgoing = senderDid === currentDID && toDids.includes(peerDid);
                    return incoming || outgoing;
                }
            })
            .sort(([, a]: any, [, b]: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .map(([did, itm]: any) => {
                const model: MessageModel = {
                    message: itm.message.body ?? "",
                    sender: itm.sender,
                    direction: itm.sender === currentId ? "outgoing" : "incoming",
                    sentTime: formatTime(itm.date),
                    position: "single",
                }
                return { did, model }
            })

        for (let i = 0; i < convo.length; i++) {
            const prevDir = convo[i - 1]?.model.direction;
            const currDir = convo[i].model.direction;
            const nextDir = convo[i + 1]?.model.direction;

            if (prevDir !== currDir && nextDir !== currDir) {
                convo[i].model.position = "single";
            } else if (prevDir !== currDir) {
                convo[i].model.position = "first";
            } else if (nextDir !== currDir) {
                convo[i].model.position = "last";
            } else {
                convo[i].model.position = "normal";
            }
        }

        return convo;
    }, [activePeer, currentDID, peerDid, currentId, dmailList, groupList, nameList, keymaster, currentGroupMembers])

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
    const peerAvatar = uiPeer ? (customAvatarUrl ?? avatarDataUrl(peerDid || uiPeer)) : "";

    return (
        <>
            <WarningModal
                isOpen={removeOpen}
                title="Remove user?"
                warningText={`This will remove "${activePeer}" from your contacts.`}
                onSubmit={confirmRemove}
                onClose={() => setRemoveOpen(false)}
            />

            <QRCodeModal
                isOpen={qrOpen}
                onClose={() => setQrOpen(false)}
                did={peerDid}
                name={uiPeer}
                userAvatar={peerAvatar}
            />

            <SlideInRight isOpen={!!activePeer} bg={colorMode === "dark" ? "gray.900" : "white"} bottomOffset={0} zIndex={2200} position="fixed">
                {uiPeer && (
                    <ChatContainer style={{ height: "100%" }}>
                        <ConversationHeader>
                            <ConversationHeader.Back onClick={onBack} />
                            <Avatar src={peerAvatar} name={uiPeer} />
                            <ConversationHeader.Content
                                userName={uiPeer}
                                info={(
                                    currentGroupMembers.length
                                        ? `${currentGroupMembers.length} members`
                                        : truncateMiddle(peerDid, 25)
                                )}
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
                                                {currentGroupMembers.length === 0 && (
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
                                const displayMessage = hasImages && m.model.message === IMAGE_PLACEHOLDER ? "" : m.model.message;
                                return (
                                    <Message
                                        key={m.did}
                                        model={{
                                            ...m.model,
                                            message: displayMessage,
                                            type: hasImages && displayMessage === "" ? "custom" : undefined,
                                        }}
                                    >
                                        <Message.Header sentTime={m.model!.sentTime} />
                                        {hasImages && (
                                            <Message.CustomContent>
                                                <div>
                                                    {imageAttachments[m.did].map(img => (
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
                                                    ))}
                                                </div>
                                            </Message.CustomContent>
                                        )}
                                    </Message>
                                )})}
                        </MessageList>

                        <MessageInput
                            placeholder={`Message ${uiPeer}`}
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
                <Box position="fixed" inset={0} zIndex={2400} display="flex" alignItems="center" justifyContent="center">
                    <CloseButton position="absolute" top={4} right={4} size="lg" color="white" onClick={closeImageViewer} />
                    {/* eslint-disable-next-line jsx-a11y/alt-text */}
                    <img src={imageViewerSrc} style={{ maxWidth: "100%", maxHeight: "100%" }} />
                </Box>
            )}
        </>
    )
}

export default ChatWindow;
