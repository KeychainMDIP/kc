import { useMemo, useState } from "react";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { Avatar, Conversation, ConversationList } from "@chatscope/chat-ui-kit-react";
import { avatarDataUrl } from "../utils/utils";
import { CHAT_SUBJECT } from "../constants";
import AddUserModal from "../modals/AddUserModal";
import { LuSettings, LuUserPlus } from "react-icons/lu";
import { GoHome } from "react-icons/go";
import { IconButton, Box, Flex } from "@chakra-ui/react";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import Settings from "./Settings";

export default function HomePage() {
    const {
        activePeer,
        agentList,
        currentId,
        currentDID,
        nameList,
        dmailList,
        setActivePeer,
        refreshNames,
    } = useVariablesContext();
    const {
        keymaster,
    } = useWalletContext();

    const { setError, setSuccess } = useSnackbar();

    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    const handleAddUser = async (did: string, name: string) => {
        if (!keymaster) {
            return;
        }

        const aliasDID = did.trim();
        const aliasName = name.trim();
        if (!aliasDID || !aliasName) {
            return;
        }

        try {
            await keymaster.addName(aliasName, aliasDID);
        } catch (error: any) {
            setError(error);
            return;
        }

        await refreshNames();
        setSuccess(`User ${aliasName} added`);
    };

    const unreadBySender = useMemo(() => {
        const map = new Map<string, number>();
        if (!dmailList || !currentId) {
            return map;
        }

        for (const [, itm] of Object.entries(dmailList)) {
            if (itm.message?.subject !== CHAT_SUBJECT) {
                continue;
            }

            const tags = itm.tags ?? [];
            if (tags.includes("deleted") || tags.includes("archived")) {
                continue;
            }

            if (!tags.includes("unread")) {
                continue;
            }

            const incoming = itm.sender !== currentId && (itm.to ?? []).includes(currentId)
            if (!incoming) {
                continue
            }

            map.set(itm.sender, (map.get(itm.sender) ?? 0) + 1)
        }
        return map
    }, [dmailList, currentId])

    return (
        <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <AddUserModal
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                onSubmit={handleAddUser}
            />

            <Settings
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            <Box position="sticky" top="0" zIndex={100} borderBottomWidth="1px">
                <Flex h="35px" align="center" px={2} justify="flex-end">
                    <IconButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddOpen(true)}
                    >
                        <LuUserPlus />
                    </IconButton>
                </Flex>
            </Box>

            <Box flex="1" overflowY="auto">
                <ConversationList>
                    {Object.entries(nameList)
                        .filter(([name]) => agentList.includes(name) && currentId !== name)
                        .map(([name, did]) => {
                            if (did === currentDID) {
                                return;
                            }
                            const src = avatarDataUrl(did, 64);
                            const selected = activePeer === name;
                            const unreadCnt = unreadBySender.get(name) ?? 0;

                            return (
                                <Conversation
                                    key={did}
                                    name={name}
                                    unreadCnt={unreadCnt > 0 ? unreadCnt : undefined}
                                    onClick={() => setActivePeer(name)}
                                    active={selected}
                                >
                                    <Avatar src={src} />
                                </Conversation>
                            )
                        })}
                </ConversationList>
            </Box>

            <Box
                position="sticky"
                bottom="0"
                zIndex={100}
                borderTopWidth="1px"
            >
                <Flex h="45px" align="center">
                    <Box flex="1" display="flex" justifyContent="center">
                        <IconButton
                            variant="ghost"
                            size="md"
                            onClick={() => setIsSettingsOpen(false)}
                        >
                            <GoHome />
                        </IconButton>
                    </Box>
                    <Box flex="1" display="flex" justifyContent="center">
                        <IconButton
                            variant="ghost"
                            size="md"
                            onClick={() => setIsSettingsOpen(true)}
                        >
                            <LuSettings />
                        </IconButton>
                    </Box>
                </Flex>
            </Box>
        </div>
    )
}
