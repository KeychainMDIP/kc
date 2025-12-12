import { useEffect, useMemo, useState } from "react";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { Avatar, Conversation, ConversationList } from "@chatscope/chat-ui-kit-react";
import {avatarDataUrl, arraysMatchMembers, convertNamesToDIDs, truncateMiddle} from "../utils/utils";
import {CHAT_SUBJECT, MESSAGING_PROFILE} from "../constants";
import AddUserModal from "../modals/AddUserModal";
import CreateGroupModal from "../modals/CreateGroupModal";
import { LuUser, LuUserPlus, LuMessagesSquare, LuUsers } from "react-icons/lu";
import { IconButton, Box, Flex, Text, Input, Spinner } from "@chakra-ui/react";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import Profile from "./Profile";
import WarningModal from "../modals/WarningModal";

export default function HomePage() {
    const {
        activePeer,
        agentList,
        currentId,
        currentDID,
        nameList,
        displayNameList,
        dmailList,
        setActivePeer,
        refreshNames,
        profileList,
        groupList,
        resolveAvatar,
    } = useVariablesContext();
    const { keymaster, search } = useWalletContext();
    const { setSuccess, setError } = useSnackbar();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [isAddGroupOpen, setIsAddGroupOpen] = useState(false);
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [addUserError, setAddUserError] = useState("");
    const [searchText, setSearchText] = useState("");
    const [globalLoading, setGlobalLoading] = useState(false);
    const [globalResults, setGlobalResults] = useState<Array<{ did: string; name: string; avatar?: string }>>([]);
    const [confirmAdd, setConfirmAdd] = useState<{ open: boolean; did?: string; name?: string }>({ open: false });

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

            if (!existingProfile.name || typeof existingProfile.name !== "string" || !existingProfile.name.trim()) {
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

        const getToDids = (itm: any): string[] => {
            const msgTo = itm.message?.to;
            if (Array.isArray(msgTo) && msgTo.length) {
                return msgTo;
            }
            return convertNamesToDIDs(itm.to ?? [], nameList);
        };

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

            const senderDid = itm.docs?.didDocument?.controller;
            if (!senderDid) {
                continue;
            }

            const toDids = getToDids(itm);
            const isGroup = toDids.length > 1;

            if (isGroup) {
                for (const [name, members] of Object.entries(groupList)) {
                    const memberDids = convertNamesToDIDs(members, nameList);
                    if (arraysMatchMembers(toDids, memberDids)) {
                        map.set(name, (map.get(name) ?? 0) + 1);
                        break;
                    }
                }
            } else {
                const incoming = senderDid !== currentDID && toDids.includes(currentDID);
                if (incoming) {
                    map.set(senderDid, (map.get(senderDid) ?? 0) + 1);
                }
            }
        }
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dmailList, currentId, nameList, groupList])

    const startsWithCi = (full: string, prefix: string) => full.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase());

    const filteredGroupNames = useMemo(() => {
        const groups = Object.keys(groupList);
        if (!searchText.trim()) {
            return groups;
        }
        return groups.filter(name => startsWithCi(name, searchText.trim()));
    }, [groupList, searchText]);

    const filteredAgentEntries = useMemo(() => {
        const entries = Object.entries(displayNameList).filter(([name]) => agentList.includes(name));
        if (!searchText.trim()) {
            return entries;
        }
        return entries.filter(([name]) => startsWithCi(name, searchText.trim()));
    }, [agentList, searchText, displayNameList]);

    useEffect(() => {
        let cancelled = false;
        const q = searchText.trim();
        if (!q) {
            setGlobalResults([]);
            setGlobalLoading(false);
            return;
        }

        const run = async () => {
            if (!search || !keymaster) {
                setGlobalResults([]);
                return;
            }
            setGlobalLoading(true);
            try {
                const where = { "didDocumentData.*": { $in: [MESSAGING_PROFILE] } };
                const dids = await search.search({ where });
                const out: Array<{ did: string; name: string; avatar?: string }> = [];

                for (const did of dids) {
                    if (did === currentDID) {
                        continue;
                    }
                    if (Object.values(nameList).includes(did)) {
                        continue;
                    }
                    try {
                        const doc = await keymaster.resolveDID(did);
                        if (doc.mdip?.type !== "agent") {
                            continue;
                        }
                        const data: Record<string, any> = doc.didDocumentData ?? {};
                        const profile: Record<string, any> | undefined = data[MESSAGING_PROFILE];
                        if (!profile || typeof profile !== 'object') {
                            continue;
                        }
                        const name = typeof profile.name === 'string' ? profile.name : undefined;
                        if (!name || !startsWithCi(name, q)) {
                            continue;
                        }
                        const avatarDid = typeof profile.avatar === 'string' ? profile.avatar : undefined;

                        let avatar: string | null = "";
                        if (avatarDid) {
                            avatar = await resolveAvatar(avatarDid);
                        }
                        const avatarUrl = avatar ? avatar : avatarDataUrl(did);
                        out.push({ did, name, avatar: avatarUrl });
                    } catch {}
                }

                if (!cancelled) {
                    setGlobalResults(out);
                }
            } catch {
                if (!cancelled) {
                    setGlobalResults([]);
                }
            } finally {
                if (!cancelled) {
                    setGlobalLoading(false);
                }
            }
        };

        const handle = setTimeout(run, 250);
        return () => { cancelled = true; clearTimeout(handle); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchText, search, keymaster, nameList, currentDID]);

    const handleSearchAddUser = async () => {
        const did = confirmAdd.did;
        setConfirmAdd({ open: false });
        if (!did) {
            return;
        }
        const existing = Object.entries(nameList).find(([, v]) => v === did);
        if (existing) {
            setError(`User already added as ${existing[0]}`);
            return;
        }
        await handleAddUser(did);
    }

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


            <WarningModal
                isOpen={confirmAdd.open}
                title={confirmAdd.name ? `Add ${confirmAdd.name}?` : "Add user?"}
                warningText={confirmAdd.name ? `Do you want to add ${confirmAdd.name} to your contacts?` : "Do you want to add this user to your contacts?"}
                onSubmit={handleSearchAddUser}
                onClose={() => setConfirmAdd({ open: false })}
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
                <Box px={2} pb={2}>
                    <Input
                        size="sm"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder="Search by name…"
                    />
                </Box>
            </Box>

            <Box flex="1" overflowY="auto">
                <ConversationList style={{ height: "auto", overflow: "visible" }}>
                    {filteredGroupNames.map((groupName) => {
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
                    {filteredAgentEntries
                        .map(([name, did]) => {
                            if (did === currentDID) {
                                return null;
                            }

                            const profile = profileList[name];
                            const customAvatarUrl = profile?.avatar;
                            const src = customAvatarUrl ? customAvatarUrl : avatarDataUrl(did);

                            const selected = activePeer === name;
                            const unreadCnt = unreadBySender.get(did) ?? 0;

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

                {searchText.trim() && (
                    <>
                        <Box px={3} py={2}>
                            <Flex align="center" gap={2}>
                                <Text fontSize="xs" opacity={0.7}>Global results</Text>
                                {globalLoading && <Spinner size="xs" />}
                            </Flex>
                        </Box>
                        <ConversationList style={{ height: "auto", overflow: "visible" }}>
                            {globalResults.map(({ did, name, avatar }) => {
                                const src = avatar ? avatar : avatarDataUrl(did);
                                return (
                                    <Conversation
                                        key={`global-${did}`}
                                        name={name}
                                        info={truncateMiddle(did)}
                                        onClick={() => setConfirmAdd({ open: true, did, name })}
                                    >
                                        <Avatar src={src} />
                                    </Conversation>
                                );
                            })}
                        </ConversationList>
                    </>
                )}
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
