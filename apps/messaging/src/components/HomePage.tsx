import { useMemo, useState } from "react";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { Avatar, Conversation, ConversationList } from "@chatscope/chat-ui-kit-react";
import {avatarDataUrl, arraysMatchMembers, convertNamesToDIDs} from "../utils/utils";
import {CHAT_SUBJECT, MESSAGING_PROFILE} from "../constants";
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
        profileList,
        groupList,
    } = useVariablesContext();
    const { keymaster } = useWalletContext();

    const { setSuccess } = useSnackbar();

    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [addUserError, setAddUserError] = useState("");

    const handleAddUser = async (did: string) => {
        if (!keymaster) {
            return;
        }

        const aliasDID = did.trim();
        if (!aliasDID) {
            setAddUserError("Invalid DID");
            return;
        }

        if (Object.values(nameList).includes(aliasDID)) {
            const key = Object.keys(nameList).find(key => nameList[key] === aliasDID);
            setAddUserError(`User already added as ${key}`);
            return;
        }

        let aliasName = "";
        try {
            const doc = await keymaster.resolveDID(aliasDID);
            if (doc.mdip?.type !== "agent") {
                setAddUserError("DID is not an agent");
                return;
            }

            const data: Record<string, any> = doc.didDocumentData ?? {};
            const existingProfile: Record<string, any> = data[MESSAGING_PROFILE] ?? {};

            if (!existingProfile.name || existingProfile.name !== String || !existingProfile.name.trim()) {
                setAddUserError("This is not a valid messaging user");
                return;
            }

            aliasName = existingProfile.name;
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
            let group = false;
            if (itm.to.length > 1) {
                group = true;
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

            if (group) {
                for (const [name, members] of Object.entries(groupList)) {
                    if (arraysMatchMembers(convertNamesToDIDs(itm.to, nameList), convertNamesToDIDs(members, nameList))) {
                        map.set(name, (map.get(name) ?? 0) + 1);
                        break;
                    }
                }
            } else {
                const incoming = itm.sender !== currentId && (itm.to ?? []).includes(currentId)
                if (!incoming) {
                    continue
                }
                map.set(itm.sender, (map.get(itm.sender) ?? 0) + 1);
            }
        }
        return map
    }, [dmailList, currentId, nameList, groupList])

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
                        onClick={() => {
                            setAddUserError("");
                            setIsAddOpen(true);
                        }}
                    >
                        <LuUserPlus />
                    </IconButton>
                </Flex>
            </Box>

            <Box flex="1" overflowY="auto">
                <ConversationList>
                    {Object.keys(groupList).map((groupName) => {
                        const groupDID = nameList[groupName];
                        if (!groupDID) {
                            return null;
                        }

                        const src = avatarDataUrl(groupDID);
                        const selected = activePeer === groupName;
                        const unreadCnt = unreadBySender.get(groupName) ?? 0;

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

                            const profile = profileList[name];
                            const customAvatarUrl = profile?.avatar;
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
