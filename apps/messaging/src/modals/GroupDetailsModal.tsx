import React from "react";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import { Box, Dialog, Flex, Heading, IconButton, Portal, Text } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { truncateMiddle } from "../utils/utils";

export type GroupMemberDisplay = {
    avatar: string;
    did: string;
    isCurrentUser: boolean;
    name: string;
};

interface GroupDetailsModalProps {
    isOpen: boolean;
    onClose: () => void;
    groupAvatar: string;
    groupId: string;
    groupName: string;
    members: GroupMemberDisplay[];
    onMemberSelect: (member: GroupMemberDisplay) => void;
}

const GroupDetailsModal: React.FC<GroupDetailsModalProps> = ({
    isOpen,
    onClose,
    groupAvatar,
    groupId,
    groupName,
    members,
    onMemberSelect,
}) => {
    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open) {
            onClose();
        }
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Portal>
                <Dialog.Backdrop zIndex={2310} bg="blackAlpha.600" />
                <Dialog.Positioner zIndex={2320}>
                    <Dialog.Content zIndex={2320} bg={{ base: "white", _dark: "gray.800" }}>
                        <Box display="flex" flexDir="column" minH="100%">
                            <Flex as="header" align="center" gap={3} px={2} py={3}>
                                <IconButton variant="ghost" onClick={onClose}>
                                    <LuArrowLeft />
                                </IconButton>
                                <Heading size="sm">Group Details</Heading>
                            </Flex>

                            <Box as="main" flex={1} overflowY="auto" px={4} py={6}>
                                <Flex direction="column" align="center" gap={2} mb={6}>
                                    <Avatar size="lg" src={groupAvatar} name={groupName} />
                                    <Text fontWeight="semibold" fontSize="lg" textAlign="center">
                                        {groupName}
                                    </Text>
                                    <Text fontSize="sm" maxW="100%" whiteSpace="nowrap">
                                        {truncateMiddle(groupId)}
                                    </Text>
                                </Flex>

                                <Box>
                                    <Text fontWeight="semibold" mb={3}>
                                        Members ({members.length})
                                    </Text>

                                    <Box display="flex" flexDirection="column" gap={2}>
                                        {members.length > 0 ? (
                                            members.map(member => (
                                                <Flex
                                                    key={member.did}
                                                    as="button"
                                                    align="center"
                                                    gap={3}
                                                    width="100%"
                                                    px={3}
                                                    py={2}
                                                    borderWidth="1px"
                                                    borderRadius="md"
                                                    bg={{ base: "white", _dark: "gray.800" }}
                                                    textAlign="left"
                                                    cursor="pointer"
                                                    _hover={{ bg: { base: "gray.50", _dark: "gray.700" } }}
                                                    onClick={() => onMemberSelect(member)}
                                                >
                                                    <Avatar size="sm" src={member.avatar} name={member.name} />
                                                    <Box minW={0} flex={1}>
                                                        <Text fontWeight="medium" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                                            {member.name}{member.isCurrentUser ? " (You)" : ""}
                                                        </Text>
                                                        <Text fontSize="sm" color="gray.500" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                                            {truncateMiddle(member.did, 32)}
                                                        </Text>
                                                    </Box>
                                                </Flex>
                                            ))
                                        ) : (
                                            <Text color="gray.500">No members found</Text>
                                        )}
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    );
};

export default GroupDetailsModal;
