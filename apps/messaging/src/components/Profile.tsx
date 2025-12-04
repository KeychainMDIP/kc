import { useState } from "react";
import { Box, Flex, Text, IconButton, Button, HStack, Input, Spinner } from "@chakra-ui/react";
import { useColorMode } from "../contexts/ColorModeProvider";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import { truncateMiddle } from "../utils/utils";
import { LuQrCode, LuSettings, LuChevronRight, LuCamera } from "react-icons/lu";
import EditProfileModal from "../modals/EditProfileModal";
import QRCodeModal from "../modals/QRCodeModal";
import { useVariablesContext } from "../contexts/VariablesProvider";
import SettingsMenu from "./settings/SettingsMenu";
import useAvatarUploader from "../hooks/useAvatarUploader";

export interface ProfileProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Profile({ isOpen }: ProfileProps) {
    const {
        currentId,
        currentDID,
    } = useVariablesContext();
    const { colorMode } = useColorMode();

    const [editOpen, setEditOpen] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const { isUploading, fileInputRef, handleAvatarClick, handleFileChange, userAvatar } = useAvatarUploader();

    if (!isOpen) {
        return;
    }

    return (
        <>
            <EditProfileModal isOpen={editOpen} onClose={() => setEditOpen(false)} />

            <QRCodeModal
                isOpen={qrOpen}
                onClose={() => setQrOpen(false)}
                did={currentDID}
                name={currentId}
                userAvatar={userAvatar}
            />

            <SettingsMenu
                isOpen={isSettingsOpen}
                onClose={() => setIsSettingsOpen(false)}
            />

            <Input
                type="file"
                ref={fileInputRef}
                display="none"
                accept="image/*"
                onChange={handleFileChange}
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
                    <Box
                        position="relative"
                        cursor="pointer"
                        onClick={handleAvatarClick}
                        role="group"
                    >
                        <Avatar
                            size="lg"
                            src={userAvatar}
                            style={{ opacity: isUploading ? 0.5 : 1 }}
                        />

                        <Flex
                            position="absolute"
                            bottom="-5px"
                            right="-5px"
                            borderRadius="full"
                            align="center"
                            justify="center"
                        >
                            {isUploading ? (
                                <Spinner color="white" />
                            ) : (
                                <LuCamera color="white" />
                            )}
                        </Flex>
                    </Box>

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
                        onClick={() => setEditOpen(true)}
                    >
                        Edit
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
