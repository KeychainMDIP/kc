import { useState } from "react";
import { Box, Flex, Text, IconButton, Button, HStack } from "@chakra-ui/react";
import { useColorMode } from "../contexts/ColorModeProvider";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import { avatarDataUrl, truncateMiddle } from "../utils/utils";
import { LuPencil, LuQrCode, LuSettings, LuChevronRight } from "react-icons/lu";
import TextInputModal from "../modals/TextInputModal";
import QRCodeModal from "../modals/QRCodeModal";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import Settings from "./Settings";

export interface ProfileProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Profile({ isOpen }: ProfileProps) {
    const { currentId, currentDID, refreshCurrentID } = useVariablesContext();
    const { keymaster } = useWalletContext();
    const { setError } = useSnackbar();
    const { colorMode } = useColorMode();

    const [renameOpen, setRenameOpen] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);

    if (!isOpen) {
        return;
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
                description="Enter a new name"
                confirmText="Rename"
                defaultValue={currentId}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <QRCodeModal
                isOpen={qrOpen}
                onClose={() => setQrOpen(false)}
                did={currentDID}
                name={currentId}
                userAvatar={userAvatar}
            />

            <Settings
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            <Box
                position="absolute"
                top="0"
                left="0"
                right="0"
                bottom="46px"
                zIndex={1100}
                bg={colorMode === "dark" ? "gray.900" : "white"}
                display="flex"
                flexDirection="column"
            >
                <Flex
                    as="header"
                    direction="column"
                    align="center"
                    justify="center"
                    w="100%"
                    px={2}
                    py={3}
                    gap={2}
                    borderBottomWidth="1px"
                    position="relative"
                >
                    <Avatar src={userAvatar} />
                    <Text fontWeight="semibold">{currentId}</Text>
                    <Text fontSize="sm" maxW="100%" whiteSpace="nowrap">
                        {truncateMiddle(currentDID)}
                    </Text>

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

                    <IconButton
                        position="absolute"
                        top="8px"
                        left="8px"
                        variant="ghost"
                        size="sm"
                        onClick={() => setQrOpen(true)}
                    >
                        <LuQrCode />
                    </IconButton>
                </Flex>

                <Box as="main" flex="1" overflowY="auto" px={4}>
                    <Box py={3}>
                        <Button
                            width="100%"
                            justifyContent="space-between"
                            onClick={() => setIsSettingsOpen(true)}
                            variant="outline"
                        >
                            <HStack gap={3} flex="1">
                                <LuSettings />
                                <Text>Settings</Text>
                            </HStack>
                            <LuChevronRight />
                        </Button>
                    </Box>
                </Box>
            </Box>
        </>
    );
}
