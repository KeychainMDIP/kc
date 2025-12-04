import React, { useState, useRef } from "react";
import { Box, Flex, Text, IconButton, Button, HStack, Input, Spinner } from "@chakra-ui/react";
import { useColorMode } from "../contexts/ColorModeProvider";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import { avatarDataUrl, truncateMiddle } from "../utils/utils";
import { LuPencil, LuQrCode, LuSettings, LuChevronRight, LuCamera } from "react-icons/lu";
import TextInputModal from "../modals/TextInputModal";
import QRCodeModal from "../modals/QRCodeModal";
import { useWalletContext } from "../contexts/WalletProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { useVariablesContext } from "../contexts/VariablesProvider";
import SettingsMenu from "./settings/SettingsMenu";
import { PROFILE_SCHEMA, PROFILE_SCHEMA_ID, PROFILE_VC_ALIAS } from "../constants";

export interface ProfileProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function Profile({ isOpen }: ProfileProps) {
    const {
        avatarList,
        currentId,
        currentDID,
        nameList,
        refreshCurrentID,
        refreshNames,
    } = useVariablesContext();
    const { keymaster } = useWalletContext();
    const { setError, setSuccess, setWarning } = useSnackbar();
    const { colorMode } = useColorMode();

    const [renameOpen, setRenameOpen] = useState(false);
    const [qrOpen, setQrOpen] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);

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

    const handleAvatarClick = () => {
        if (!isUploading && fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !keymaster) {
            return;
        }

        try {
            setIsUploading(true);

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const assetDid = await keymaster.createImage(buffer);

            const existingVcDid = nameList[PROFILE_VC_ALIAS];

            if (existingVcDid) {
                try {
                    const vc = await keymaster.getCredential(existingVcDid);

                    if (vc && vc.credential) {
                        vc.credential[PROFILE_SCHEMA_ID] = assetDid;

                        await keymaster.updateCredential(existingVcDid, vc);
                        await keymaster.publishCredential(existingVcDid, { reveal: true });

                        setSuccess("Profile picture updated!");
                        await refreshNames();
                        return;
                    }
                } catch {
                    setWarning("Failed to update, creating new");
                }
            }

            let schemaDid;
            if (nameList[PROFILE_SCHEMA_ID] === undefined) {
                schemaDid = await keymaster.createSchema(PROFILE_SCHEMA);
                await keymaster.addName(PROFILE_SCHEMA_ID, schemaDid);
            } else {
                schemaDid = nameList[PROFILE_SCHEMA_ID];
            }

            const boundCredential = await keymaster.bindCredential(
                schemaDid,
                currentDID,
                { credential: { [PROFILE_SCHEMA_ID]: assetDid } }
            );

            const vcDid = await keymaster.issueCredential(boundCredential);
            await keymaster.acceptCredential(vcDid);
            await keymaster.publishCredential(vcDid, { reveal: true });
            await keymaster.addName(PROFILE_VC_ALIAS, vcDid);

            setSuccess("Profile picture set!");
            await refreshNames();
        } catch (e: any) {
            setError(e);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = "";
            }
        }
    };

    const customAvatarUrl = avatarList[currentId];
    const userAvatar = customAvatarUrl ? customAvatarUrl : avatarDataUrl(currentDID, 64);

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
                        onClick={() => setRenameOpen(true)}
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
