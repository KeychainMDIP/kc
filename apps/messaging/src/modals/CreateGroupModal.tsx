import React, { useState, useEffect } from "react";
import { Dialog, Box, Flex, IconButton, Text, Field, Input, Button, Portal } from "@chakra-ui/react";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { LuX } from "react-icons/lu";
import { CHAT_SUBJECT } from "../constants";
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
        refreshNames,
    } = useVariablesContext();
    const { keymaster, registry } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();

    const [groupName, setGroupName] = useState<string>("");
    const [searchTerm, setSearchTerm] = useState<string>("");
    const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

    useEffect(() => {
        if (isOpen) {
            setGroupName("");
            setSearchTerm("");
            setSelectedMembers([]);
        }
    }, [isOpen]);

    const handleAddMember = (memberName?: string) => {
        const trimmed = (memberName || searchTerm).trim();
        if (!trimmed) {
            return;
        }

        if (!agentList.includes(trimmed)) {
            setError("User not found in agent list");
            return;
        }

        if (selectedMembers.includes(trimmed)) {
            setError("User already added to group");
            return;
        }

        setSelectedMembers([...selectedMembers, trimmed]);
        setSearchTerm("");
    };

    const handleRemoveMember = (member: string) => {
        setSelectedMembers(selectedMembers.filter(m => m !== member));
    };

    const handleCreate = async () => {
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
            const groupId = await keymaster.createGroup(trimmed);
            const memberDids = selectedMembers
                .filter(member => member !== currentId)
                .map(member => displayNameList[member] ?? nameList[member] ?? member)
                .filter(member => !!member);
            const recipients = Array.from(new Set([currentDID, ...memberDids]));

            for (const memberDid of recipients) {
                await keymaster.addGroupMember(groupId, memberDid);
            }

            const body = stringifyChatPayload({
                groupId,
                groupName: trimmed,
            });
            const dmail = {
                to: recipients,
                cc: [],
                subject: CHAT_SUBJECT,
                body,
            };
            const did = await keymaster.createDmail(dmail, { registry });
            await keymaster.sendDmail(did);

            await refreshNames();
            setSuccess(`Group "${trimmed}" created`);
            onClose();
        } catch (error: any) {
            setError(error);
        }
    };

    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open) onClose();
    };

    const filteredAgents = agentList.filter(agent =>
        agent.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Box display="flex" flexDir="column" minH="100%">
                            <Flex as="header" direction="column" w="100%" px={2} pt={10} gap={2} position="relative">
                                <IconButton position="absolute" top="8px" left="8px" variant="ghost" size="sm" onClick={onClose}>
                                    Cancel
                                </IconButton>
                                <IconButton
                                    position="absolute"
                                    top="8px"
                                    right="8px"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleCreate}
                                    disabled={!groupName.trim() || selectedMembers.length === 0}
                                >
                                    Create
                                </IconButton>

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
                                    />
                                </Field.Root>

                                <Field.Root>
                                    <Field.Label fontWeight="medium">Add Members</Field.Label>
                                    <Flex gap={2}>
                                        <Input
                                            type="text"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            placeholder="Search users..."
                                            list="agent-suggestions"
                                        />
                                        <Button
                                            size="sm"
                                            onClick={() => handleAddMember()}
                                            disabled={!searchTerm.trim()}
                                        >
                                            Add
                                        </Button>
                                    </Flex>
                                    {searchTerm && filteredAgents.length > 0 && (
                                        <Box mt={2} borderWidth="1px" borderRadius="md" maxH="150px" overflowY="auto">
                                            {filteredAgents.slice(0, 5).map(agent => (
                                                <Box
                                                    key={agent}
                                                    px={3}
                                                    py={2}
                                                    cursor="pointer"
                                                    _hover={{ bg: "gray.100" }}
                                                    onClick={() => handleAddMember(agent)}
                                                >
                                                    {agent}
                                                </Box>
                                            ))}
                                        </Box>
                                    )}
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
