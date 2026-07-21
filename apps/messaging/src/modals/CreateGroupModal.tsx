import React, { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, Box, Flex, IconButton, Text, Field, Input, Button, Portal } from "@chakra-ui/react";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { LuX } from "react-icons/lu";
import {
    CHAT_SUBJECT,
    DMAIL_TAG_FAILED,
    GROUP_MEMBERSHIP_ACTION_CREATED,
    GROUP_MEMBERSHIP_PAYLOAD_TYPE,
    LOCAL_GROUP_ID_PREFIX,
} from "../constants";
import { stringifyChatPayload } from "../utils/utils";

interface CreateGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const CreateGroupModal: React.FC<CreateGroupModalProps> = ({ isOpen, onClose }) => {
    const {
        agentList,
        currentId,
        currentDID,
        nameList,
        displayNameList,
        setGroupList,
        refreshInbox,
    } = useVariablesContext();
    const { keymaster, registry } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();

    const [groupName, setGroupName] = useState<string>("");
    const [searchTerm, setSearchTerm] = useState<string>("");
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
    const [creating, setCreating] = useState<boolean>(false);
    const [memberPickerOpen, setMemberPickerOpen] = useState<boolean>(false);
    const memberPickerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            setGroupName("");
            setSearchTerm("");
            setSelectedMembers([]);
            setCreating(false);
            setMemberPickerOpen(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (creating) {
            setMemberPickerOpen(false);
        }
    }, [creating]);

    useEffect(() => {
        if (!memberPickerOpen) {
            return;
        }

        const handleMouseDown = (event: MouseEvent) => {
            if (!memberPickerRef.current?.contains(event.target as Node)) {
                setMemberPickerOpen(false);
            }
        };

        document.addEventListener("mousedown", handleMouseDown);
        return () => document.removeEventListener("mousedown", handleMouseDown);
    }, [memberPickerOpen]);

    const getAgentDid = (agent: string) => displayNameList[agent] ?? nameList[agent] ?? "";
    const isCurrentUserAgent = (agent: string) => agent === currentId || (!!currentDID && getAgentDid(agent) === currentDID);

    const availableAgents = useMemo(() => {
        return agentList.filter(agent => {
            if (!agent.trim()) {
                return false;
            }

            if (selectedMembers.includes(agent)) {
                return false;
            }

            return !isCurrentUserAgent(agent);
        });
    }, [agentList, currentDID, currentId, displayNameList, nameList, selectedMembers]);

    const filteredAgents = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) {
            return availableAgents;
        }

        return availableAgents.filter(agent =>
            agent.toLowerCase().includes(term)
        );
    }, [availableAgents, searchTerm]);

    const handleAddMember = (memberName?: string) => {
        if (creating) {
            return;
        }

        const trimmed = (memberName || searchTerm).trim();
        if (!trimmed) {
            return;
        }

        if (!agentList.includes(trimmed)) {
            setError("User not found in agent list");
            return;
        }

        if (isCurrentUserAgent(trimmed)) {
            setError("You are already included in the group");
            return;
        }

        if (selectedMembers.includes(trimmed)) {
            setError("User already added to group");
            return;
        }

        setSelectedMembers([...selectedMembers, trimmed]);
        setSearchTerm("");
        setMemberPickerOpen(availableAgents.some(agent => agent !== trimmed));
    };

    const handleRemoveMember = (member: string) => {
        if (creating) {
            return;
        }

        setSelectedMembers(selectedMembers.filter(m => m !== member));
    };

    const handleCreate = async () => {
        if (creating) {
            return;
        }

        const trimmed = groupName.trim();
        if (!trimmed) {
            setError("Group name is required");
            return;
        }

        if (selectedMembers.length === 0) {
            setError("At least one member is required");
            return;
        }

        if (!keymaster) {
            setError("Keymaster not available");
            return;
        }

        try {
            setCreating(true);

            const memberDids = selectedMembers
                .filter(member => member !== currentId)
                .map(member => displayNameList[member] ?? nameList[member] ?? member)
                .filter(member => !!member && member !== currentDID);
            const recipients = Array.from(new Set([currentDID, ...memberDids]));

            if (!currentDID || recipients.length < 2) {
                setError("At least one other member is required");
                return;
            }

            const randomId = typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            const groupId = `${LOCAL_GROUP_ID_PREFIX}:${randomId}`;
            const updatedAt = new Date().toISOString();
            const body = stringifyChatPayload({
                type: GROUP_MEMBERSHIP_PAYLOAD_TYPE,
                version: 1,
                groupId,
                groupName: trimmed,
                action: GROUP_MEMBERSHIP_ACTION_CREATED,
                members: recipients,
                updatedAt,
            });
            const dmail = {
                to: recipients,
                cc: [],
                subject: CHAT_SUBJECT,
                body,
            };
            const did = await keymaster.createDmail(dmail, { registry });
            const notice = await keymaster.sendDmail(did);
            if (!notice) {
                await keymaster.fileDmail(did, [DMAIL_TAG_FAILED]);
                throw new Error("Group creation send failed");
            }

            setGroupList(prev => ({
                ...prev,
                [groupId]: {
                    name: trimmed,
                    members: recipients,
                    membersUpdatedAt: updatedAt,
                },
            }));
            await refreshInbox();
            setSuccess(`Group "${trimmed}" created`);
            onClose();
        } catch (error: any) {
            setError(error);
        } finally {
            setCreating(false);
        }
    };

    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open && !creating) {
            onClose();
        }
    };

    const handleCancel = () => {
        if (!creating) {
            onClose();
        }
    };

    const createDisabled = creating || !groupName.trim() || selectedMembers.length === 0;

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Box display="flex" flexDir="column" minH="100%">
                            <Flex as="header" direction="column" w="100%" px={2} pt={10} gap={2} position="relative">
                                <Button
                                    position="absolute"
                                    top="8px"
                                    left="8px"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCancel}
                                    disabled={creating}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    position="absolute"
                                    top="8px"
                                    right="8px"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCreate}
                                    disabled={createDisabled}
                                    loading={creating}
                                    loadingText="Creating"
                                >
                                    Create
                                </Button>

                                <Text fontSize="lg" fontWeight="bold" textAlign="center">
                                    Create Group
                                </Text>
                            </Flex>

                            <Box as="main" flex={1} overflowY="auto" px={4} py={6} display="flex" flexDirection="column" gap={4}>
                                <Field.Root>
                                    <Field.Label fontWeight="medium">Group Name</Field.Label>
                                    <Input
                                        type="text"
                                        value={groupName}
                                        onChange={(e) => setGroupName(e.target.value)}
                                        placeholder="Enter group name"
                                        disabled={creating}
                                    />
                                </Field.Root>

                                <Field.Root>
                                    <Field.Label fontWeight="medium">Add Members</Field.Label>
                                    <Box ref={memberPickerRef}>
                                        <Flex gap={2}>
                                            <Input
                                                type="text"
                                                value={searchTerm}
                                                onChange={(e) => {
                                                    setSearchTerm(e.target.value);
                                                    setMemberPickerOpen(true);
                                                }}
                                                onFocus={() => setMemberPickerOpen(true)}
                                                onClick={() => setMemberPickerOpen(true)}
                                                placeholder="Search users..."
                                                autoComplete="off"
                                                disabled={creating}
                                            />
                                            <Button
                                                size="sm"
                                                onClick={() => handleAddMember()}
                                                disabled={creating || !searchTerm.trim()}
                                            >
                                                Add
                                            </Button>
                                        </Flex>
                                        {!creating && memberPickerOpen && (
                                            <Box mt={2} borderWidth="1px" borderRadius="md" maxH="150px" overflowY="auto" role="listbox">
                                                {filteredAgents.length > 0 ? (
                                                    filteredAgents.map(agent => (
                                                        <Box
                                                            key={agent}
                                                            px={3}
                                                            py={2}
                                                            cursor="pointer"
                                                            role="option"
                                                            _hover={{ bg: "gray.100" }}
                                                            onMouseDown={(event) => {
                                                                event.preventDefault();
                                                                handleAddMember(agent);
                                                            }}
                                                        >
                                                            {agent}
                                                        </Box>
                                                    ))
                                                ) : (
                                                    <Box px={3} py={2} color="gray.500">
                                                        No users found
                                                    </Box>
                                                )}
                                            </Box>
                                        )}
                                    </Box>
                                </Field.Root>

                                {selectedMembers.length > 0 && (
                                    <Box>
                                        <Text fontWeight="medium" mb={2}>Selected Members ({selectedMembers.length})</Text>
                                        <Box display="flex" flexDirection="column" gap={1}>
                                            {selectedMembers.map(member => (
                                                <Flex
                                                    key={member}
                                                    align="center"
                                                    justify="space-between"
                                                    px={2}
                                                    borderWidth="1px"
                                                    borderRadius="md"
                                                >
                                                    <Text>{member}</Text>
                                                    <IconButton
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => handleRemoveMember(member)}
                                                        disabled={creating}
                                                    >
                                                        <LuX />
                                                    </IconButton>
                                                </Flex>
                                            ))}
                                        </Box>
                                    </Box>
                                )}
                            </Box>
                        </Box>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    );
};

export default CreateGroupModal;
