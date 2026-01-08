import React, { useEffect, useState } from "react";
import { Dialog, Box, Flex, IconButton, Text, Field, Input, Spinner } from "@chakra-ui/react";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import useAvatarUploader from "../hooks/useAvatarUploader";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import {MESSAGING_PROFILE} from "../constants";

interface EditProfileModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const EditProfileModal: React.FC<EditProfileModalProps> = ({ isOpen, onClose }) => {
    const { currentId, refreshAll } = useVariablesContext();
    const { keymaster } = useWalletContext();
    const { setError } = useSnackbar();

    const { isUploading, fileInputRef, handleAvatarClick, handleFileChange, userAvatar } = useAvatarUploader();
    const [name, setName] = useState<string>(currentId);

    useEffect(() => {
        if (isOpen) {
            setName(currentId);
        }
    }, [isOpen, currentId]);

    const handleSave = async () => {
        const trimmed = name.trim();
        if (!keymaster || !trimmed || trimmed === currentId) {
            onClose();
            return;
        }
        try {
            await keymaster.renameId(currentId, trimmed);
            const doc = await keymaster.resolveDID(trimmed);
            const data: Record<string, any> = doc.didDocumentData ?? {};
            const existingProfile: Record<string, any> = data[MESSAGING_PROFILE] ?? {};

            data[MESSAGING_PROFILE] = {
                ...existingProfile,
                name: trimmed,
            };

            doc.didDocumentData = data;
            await keymaster.updateDID(doc);

            await refreshAll();
        } catch (e: any) {
            setError(e);
        } finally {
            onClose();
        }
    };

    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open) onClose();
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Box display="flex" flexDir="column" minH="100%">
                    <Flex as="header" direction="column" align="center" justify="center" w="100%" px={2} pt={10} gap={2} borderBottomWidth="1px" position="relative">
                        <IconButton position="absolute" top="8px" left="8px" variant="ghost" size="sm" onClick={onClose}>
                            Cancel
                        </IconButton>
                        <IconButton position="absolute" top="8px" right="8px" variant="ghost" size="sm" onClick={handleSave}>
                            Save
                        </IconButton>

                        <Box position="relative" cursor="pointer" onClick={handleAvatarClick} role="group">
                            <Avatar size="lg" src={userAvatar} style={{ opacity: isUploading ? 0.5 : 1 }} />
                            <Flex position="absolute" bottom="-5px" right="-5px" borderRadius="full" align="center" justify="center">
                                {isUploading ? (
                                    <Spinner color="white" />
                                ) : null}
                            </Flex>
                        </Box>
                        <Text fontSize="sm" cursor="pointer" onClick={handleAvatarClick}>
                            Edit profile picture
                        </Text>
                    </Flex>

                    <Box as="main" flex={1} overflowY="auto" px={4} py={6}>
                        <Field.Root>
                            <Field.Label fontWeight="medium">Name</Field.Label>
                            <Input type="text" value={name} onChange={(e) => setName(e.target.value)} />
                        </Field.Root>
                    </Box>

                    <input type="file" ref={fileInputRef} style={{ display: "none" }} accept="image/*" onChange={handleFileChange} />
                </Box>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default EditProfileModal;
