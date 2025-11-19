import React from "react";
import { Dialog, Box, Flex, Heading, IconButton, Button, Text } from "@chakra-ui/react";
import { LuArrowLeft } from "react-icons/lu";
import { QRCodeSVG } from "qrcode.react";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import { useSnackbar } from "../contexts/SnackbarProvider";

interface QRCodeModalProps {
    isOpen: boolean;
    onClose: () => void;
    did: string;
    name: string;
    userAvatar: string;
}

function truncateMiddle(str: string, max: number) {
    if (str.length <= max) {
        return str;
    }
    const half = Math.floor((max - 3) / 2);
    return `${str.slice(0, half)}...${str.slice(-half)}`;
}

const QRCodeModal: React.FC<QRCodeModalProps> = ({ isOpen, onClose, did, name, userAvatar }) => {
    const { setSuccess } = useSnackbar();

    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open) onClose();
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(did);
            setSuccess("Identifier copied to clipboard");
        } catch { }
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Box display="flex" flexDir="column" minH="100%">
                    <Flex as="header" align="center" gap={3} px={2} py={3}>
                        <IconButton variant="ghost" onClick={onClose}>
                            <LuArrowLeft />
                        </IconButton>
                        <Heading size="sm">Profile QR code</Heading>
                    </Flex>

                    <Box as="main" flex={1} overflowY="auto" px={4} py={6} display="flex" flexDir="column" alignItems="center" gap={6}>
                        <Box position="relative" bg="white" color="gray.900" borderRadius="lg" px={6} pt={9} pb={6} w="full" maxW="360px" boxShadow="sm">
                            <Flex direction="column" align="center" gap={3}>
                                <Flex direction="column" align="center">
                                    <Avatar src={userAvatar} />
                                    <Text fontWeight="semibold">{name}</Text>
                                </Flex>

                                <Box bg="white" p={2} borderRadius="md">
                                    <QRCodeSVG value={did} size={220} />
                                </Box>
                                <Text fontSize="sm" maxW="100%" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                                    {truncateMiddle(did, 34)}
                                </Text>
                            </Flex>
                        </Box>
                    </Box>

                    <Box as="footer" p={4}>
                        <Button w="full" onClick={handleCopy}>Copy Identifier</Button>
                    </Box>
                </Box>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default QRCodeModal;
