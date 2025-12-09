import { useMemo, useState } from "react";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { Avatar, Conversation, ConversationList } from "@chatscope/chat-ui-kit-react";
import { avatarDataUrl } from "../utils/utils";
import { CHAT_SUBJECT } from "../constants";
import AddUserModal from "../modals/AddUserModal";
import CreateGroupModal from "../modals/CreateGroupModal";
import { LuUser, LuUserPlus, LuMessagesSquare, LuUsers } from "react-icons/lu";
import { IconButton, Box, Flex, Text } from "@chakra-ui/react";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import Profile from "./Profile";

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
        avatarList,
        groupList,
    } = useVariablesContext();
    const { keymaster } = useWalletContext();

    const { setSuccess } = useSnackbar();

    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [addUserError, setAddUserError] = useState("");

    const handleAddUser = async (did: string, name: string) => {
        if (!keymaster) {
            return;
        }

        const aliasDID = did.trim();
        const aliasName = name.trim();
        if (!aliasDID || !aliasName) {
            setAddUserError("Invalid DID or name");
            return;
        }

        if (Object.values(nameList).includes(aliasDID)) {
            const key = Object.keys(nameList).find(key => nameList[key] === aliasDID);
            setAddUserError(`User already added as ${key}`);
            return;
        }

        try {
            const newDID = await keymaster.resolveDID(aliasDID);
            if (newDID.mdip?.type !== "agent") {
                setAddUserError("DID is not an agent");
                return;
            }
        } catch {
            setAddUserError("DID not found");
            return;
        }

        try {
            await keymaster.addName(aliasName, aliasDID);
        } catch (error: any) {
            setAddUserError(error);
            return;
        }

        setIsAddOpen(false);
        await refreshNames();
        setSuccess(`User ${aliasName} added`);
    };

    const unreadBySender = useMemo(() => {
        const map = new Map<string, number>();
        if (!dmailList || !currentId) {
            return map;
        }

        for (const [, itm] of Object.entries(dmailList)) {
            if (itm.to.length > 1) {
                continue;
            }

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
                errorText={addUserError}
                onSubmit={handleAddUser}
            />

            <CreateGroupModal
                isOpen={isAddGroupOpen}
                onClose={() => setIsAddGroupOpen(false)}
            />

            <Profile
                isOpen={isProfileOpen}
                onClose={() => setIsProfileOpen(false)}
            />

            <Box position="sticky" top="0" zIndex={100} borderBottomWidth="1px">
                <Flex h="35px" align="center" px={2} justify="flex-end" gap={2}>
                    <IconButton
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsAddGroupOpen(true)}
                    >
                        <LuUsers />
                    </IconButton>
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
                    {groupList.map((groupName) => {
                        const groupDID = nameList[groupName];
                        if (!groupDID) {
                            return null;
                        }

                        const src = avatarDataUrl(groupDID);
                        const selected = activePeer === groupName;
                        const unreadCnt = 0; // TODO: Calculate unread count for groups

                        return (
                            <Conversation
                                key={groupDID}
                                name={groupName}
                                unreadCnt={unreadCnt > 0 ? unreadCnt : undefined}
                                onClick={() => setActivePeer(groupName)}
                                active={selected}
                            >
                                <Avatar src={src} />
                            </Conversation>
                        );
                    })}
                    {Object.entries(nameList)
                        .filter(([name]) => agentList.includes(name) && currentId !== name)
                        .map(([name, did]) => {
                            if (did === currentDID) {
                                return null;
                            }

                            const customAvatarUrl = avatarList[name];
                            const src = customAvatarUrl ? customAvatarUrl : avatarDataUrl(did);

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
                zIndex={2000}
                borderTopWidth="1px"
            >
                <Flex h="46px" align="center">
                    <Box flex="1" display="flex" justifyContent="center">
                        <Flex direction="column" align="center">
                            <IconButton
                                variant="ghost"
                                size="md"
                                onClick={() => setIsProfileOpen(false)}
                            >
                                <LuMessagesSquare />
                            </IconButton>
                            <Text fontSize="xs" textAlign="center" mt="-8px">Chats</Text>
                        </Flex>
                    </Box>
                    <Box flex="1" display="flex" justifyContent="center">
                        <Flex direction="column" align="center">
                            <IconButton
                                variant="ghost"
                                size="md"
                                onClick={() => setIsProfileOpen(true)}
                            >
                                <LuUser />
                            </IconButton>
                            <Text fontSize="xs" textAlign="center" mt="-8px">Profile</Text>
                        </Flex>
                    </Box>
                </Flex>
            </Box>
        </div>
    )
}
