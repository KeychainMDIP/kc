import { useState } from "react";
import { Box, Flex, HStack, Text, IconButton } from "@chakra-ui/react";
import { ColorModeButton, useColorMode } from "../contexts/ColorModeProvider";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import {avatarDataUrl} from "../utils/utils";
import { LuPencil } from "react-icons/lu";
import TextInputModal from "../modals/TextInputModal";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";

export interface SettingsProps {
    isOpen: boolean
    onClose: () => void
}

export default function Settings({ isOpen }: SettingsProps) {
    const {
        currentId,
        currentDID,
        refreshCurrentID,
    } = useVariablesContext()

    const { keymaster } = useWalletContext();
    const { setError } = useSnackbar();
    const { colorMode } = useColorMode()

    const [renameOpen, setRenameOpen] = useState(false);

    if (!isOpen) {
        return null
    }

    const handleRenameSubmit = async (newName: string) => {
        const trimmed = newName.trim();
        setRenameOpen(false);
        if (!keymaster || !trimmed || trimmed === currentId) {
            return;
        }
        try {
            await keymaster.renameId(currentId, trimmed);
            await refreshCurrentID();
        } catch (e: any) {
            setError(e);
        }
    };

    const userAvatar = avatarDataUrl(currentDID, 64);

    return (
        <>
            <TextInputModal
                isOpen={renameOpen}
                title="Rename"
                description="Enter a new name."
                label="Name"
                confirmText="Rename"
                defaultValue={currentId}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <Box position="fixed" top="0" left="0" right="0" bottom="46px" zIndex={1100} bg={colorMode === "dark" ? "gray.900" : "white"} display="flex" flexDirection="column">
                <Flex as="header" direction="column" align="center" justify="center" w="100%" px={2} py={3} gap={2} borderBottomWidth="1px" position="relative">
                    <Avatar src={userAvatar} />
                    <Text fontWeight="semibold">{currentId}</Text>
                    <Text fontSize="sm" maxW="100%" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">{currentDID}</Text>

                    <IconButton
                        position="absolute"
                        top="8px"
                        right="8px"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRenameOpen(true)}
                    >
                        <LuPencil />
                    </IconButton>
                </Flex>

                <Box as="main" flex="1" overflowY="auto" px={4}>
                    <HStack justify="space-between" py={3}>
                        <HStack gap={3}>
                            <Text>Dark Mode</Text>
                        </HStack>
                        <ColorModeButton />
                    </HStack>
                </Box>
            </Box>
        </>
    )
}
