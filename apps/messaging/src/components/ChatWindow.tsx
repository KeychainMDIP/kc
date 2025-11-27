import React, { useMemo, useState, useEffect } from "react"
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
import { LuEllipsisVertical, LuQrCode, LuPencil, LuTrash2 } from "react-icons/lu";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useWalletContext } from "../contexts/WalletProvider";
import { avatarDataUrl, formatTime } from "../utils/utils";
import { CHAT_SUBJECT } from "../constants";
import TextInputModal from "../modals/TextInputModal";
import WarningModal from "../modals/WarningModal";
import QRCodeModal from "../modals/QRCodeModal";

type MessageModel = {
    message: string
    sender: string
    direction: "incoming" | "outgoing"
    sentTime?: string
    position: "single" | "first" | "normal" | "last"
}

const UNREAD = "unread"

const ChatWindow: React.FC = () => {
    const {
        activePeer,
        currentId,
        dmailList,
        nameList,
        refreshInbox,
        setActivePeer,
        refreshNames,
    } = useVariablesContext();
    const {
        keymaster,
        registry,
    } = useWalletContext();

    const [pendingText, setPendingText] = useState<string>("");
    const [sending, setSending] = useState<boolean>(false);
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameDID, setRenameDID] = useState<string>("");
    const [renameOldName, setRenameOldName] = useState<string>("");
    const [removeOpen, setRemoveOpen] = useState<boolean>(false);
    const [qrOpen, setQrOpen] = useState(false);

    const { setError } = useSnackbar();

    const onRename = () => {
        if (!activePeer) {
            return;
        }
        setRenameOldName(activePeer);
        setRenameDID(nameList[activePeer] ?? "");
        setRenameOpen(true);
    };

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
            await keymaster.removeName(activePeer);
            setActivePeer("");
            await refreshNames();
        } catch (error: any) {
            setError(error);
        } finally {
            setRemoveOpen(false);
        }
    };

    const handleRenameSubmit = async (newName: string) => {
        const trimmed = newName.trim();
        setRenameOpen(false);
        if (!trimmed || trimmed === renameOldName || !keymaster) {
            return;
        }
        try {
            await keymaster.addName(newName, renameDID);
            await keymaster.removeName(renameOldName);
            await refreshNames();
            if (activePeer === renameOldName) {
                setActivePeer(newName);
            }
        } catch (error: any) {
            setError(error);
        }
    };

    const onBack = () => {
        setActivePeer("");
    }

    useEffect(() => {
        if (!activePeer || !keymaster) {
            return;
        }

        const updates: Array<{ did: string; newTags: string[] }> = []

        for (const [did, itm] of Object.entries(dmailList || {})) {
            if (itm.message?.subject !== CHAT_SUBJECT) {
                continue;
            }

            const tags = itm.tags ?? []
            if (tags.includes("deleted") || tags.includes("archived")) {
                continue;
            }

            if (!tags.includes(UNREAD)) {
                continue;
            }

            const to = [...(itm.to || [])]
            const incoming = itm.sender === activePeer && to.includes(currentId);
            if (!incoming) {
                continue;
            }

            updates.push({ did, newTags: tags.filter(t => t !== UNREAD) });
        }

        if (updates.length === 0) {
            return;
        }

        (async () => {
            try {
                await Promise.all(
                    updates.map(({ did, newTags }) => keymaster.fileDmail(did, newTags))
                )
                await refreshInbox()
            } catch (err: any) {
                setError(err)
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePeer])

    const handleSend = async (text: string) => {
        const body = (text ?? pendingText).trim();
        if (!body || !keymaster || !currentId || !activePeer) {
            return;
        }

        try {
            setSending(true)

            const dmail = {
                to: [activePeer],
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

    const conversation = useMemo(() => {
        if (!activePeer || !currentId) {
            return [] as { did: string; model: MessageModel }[]
        }

        const convo = Object.entries(dmailList || {})
            .filter(([, itm]: any) => {
                const to = [...(itm.to || [])];
                const incoming = itm.sender === activePeer && to.includes(currentId);
                const outgoing = itm.sender === currentId && to.includes(activePeer);
                const notDeleted = !itm.tags?.includes("deleted");
                const isChat = itm.message?.subject === CHAT_SUBJECT;
                return (incoming || outgoing) && notDeleted && isChat;
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
    }, [activePeer, currentId, dmailList])


    if (!activePeer) {
        return;
    }

    const peerAvatar = avatarDataUrl(nameList[activePeer], 64);

    return (
        <>
            <TextInputModal
                isOpen={renameOpen}
                title="Rename"
                description="Enter a new name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

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
                did={nameList[activePeer]}
                name={activePeer}
                userAvatar={peerAvatar}
            />

            <ChatContainer style={{ height: "100%" }}>
                <ConversationHeader>
                    <ConversationHeader.Back onClick={onBack} />
                    <Avatar src={peerAvatar} name={activePeer} />
                    <ConversationHeader.Content userName={activePeer} info={nameList[activePeer]}/>
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
                                <MenuPositioner>
                                    <MenuContent>
                                        <MenuItem value="rename" onSelect={onRename}>
                                            <LuPencil style={{ marginRight: 8 }} />
                                            Rename
                                        </MenuItem>
                                        <MenuItem value="export" onSelect={() => setQrOpen(true)}>
                                            <LuQrCode style={{ marginRight: 8 }} />
                                            Export
                                        </MenuItem>
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
                    {conversation.map((m) => (
                        <Message key={m.did} model={m.model}>
                            <Message.Header sentTime={m.model!.sentTime} />
                        </Message>
                    ))}
                </MessageList>

                <MessageInput
                    placeholder={`Message ${activePeer}`}
                    value={pendingText}
                    onChange={setPendingText}
                    onSend={handleSend}
                    disabled={sending}
                    attachButton={false}
                    sendButton={true}
                />
            </ChatContainer>
        </>
    )
}

export default ChatWindow;
