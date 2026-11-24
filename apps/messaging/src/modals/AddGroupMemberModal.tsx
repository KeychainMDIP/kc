import React, { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@chatscope/chat-ui-kit-react";
import { Box, Button, Dialog, Field, Flex, Input, Portal, Text } from "@chakra-ui/react";
import { truncateMiddle } from "../utils/utils";

export type AddGroupMemberOption = {
    avatar: string;
    did: string;
    name: string;
};

interface AddGroupMemberModalProps {
    isOpen: boolean;
    onClose: () => void;
    options: AddGroupMemberOption[];
    adding: boolean;
    onSubmit: (option: AddGroupMemberOption) => Promise<void>;
}

const AddGroupMemberModal: React.FC<AddGroupMemberModalProps> = ({
    isOpen,
    onClose,
    options,
    adding,
    onSubmit,
}) => {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedDid, setSelectedDid] = useState("");
    const [pickerOpen, setPickerOpen] = useState(false);
    const pickerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (isOpen) {
            setSearchTerm("");
            setSelectedDid("");
            setPickerOpen(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!pickerOpen) {
            return;
        }

        const handleMouseDown = (event: MouseEvent) => {
            if (!pickerRef.current?.contains(event.target as Node)) {
                setPickerOpen(false);
            }
        };

        document.addEventListener("mousedown", handleMouseDown);
        return () => document.removeEventListener("mousedown", handleMouseDown);
    }, [pickerOpen]);

    const filteredOptions = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        if (!term) {
            return options;
        }

        return options.filter(option =>
            option.name.toLowerCase().includes(term) ||
            option.did.toLowerCase().includes(term)
        );
    }, [options, searchTerm]);

    const selectedOption = options.find(option => option.did === selectedDid);

    const handleOpenChange = (event: { open: boolean }) => {
        if (!event.open && !adding) {
            onClose();
        }
    };

    const handleSelect = (option: AddGroupMemberOption) => {
        if (adding) {
            return;
        }

        setSelectedDid(option.did);
        setSearchTerm(option.name);
        setPickerOpen(false);
    };

    const handleSubmit = async () => {
        if (!selectedOption || adding) {
            return;
        }

        await onSubmit(selectedOption);
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Portal>
                <Dialog.Backdrop zIndex={2340} bg="blackAlpha.600" />
                <Dialog.Positioner zIndex={2350}>
                    <Dialog.Content zIndex={2350} bg={{ base: "white", _dark: "gray.800" }}>
                        <Box display="flex" flexDir="column" minH="100%">
                            <Flex as="header" align="center" justify="space-between" px={2} py={3}>
                                <Button variant="ghost" onClick={onClose} disabled={adding}>
                                    Cancel
                                </Button>
                                <Text fontWeight="bold">Add Member</Text>
                                <Button
                                    colorPalette="blue"
                                    disabled={!selectedOption || adding}
                                    loading={adding}
                                    loadingText="Adding"
                                    onClick={handleSubmit}
                                    variant="ghost"
                                >
                                    Add
                                </Button>
                            </Flex>

                            <Box as="main" flex={1} overflowY="auto" px={4} py={6}>
                                <Field.Root>
                                    <Field.Label fontWeight="medium">User</Field.Label>
                                    <Box ref={pickerRef}>
                                        <Input
                                            autoComplete="off"
                                            disabled={adding}
                                            onChange={(event) => {
                                                setSearchTerm(event.target.value);
                                                setSelectedDid("");
                                                setPickerOpen(true);
                                            }}
                                            onClick={() => setPickerOpen(true)}
                                            onFocus={() => setPickerOpen(true)}
                                            placeholder="Search users..."
                                            type="text"
                                            value={searchTerm}
                                        />

                                        {!adding && pickerOpen && (
                                            <Box
                                                borderRadius="md"
                                                borderWidth="1px"
                                                maxH="220px"
                                                mt={2}
                                                overflowY="auto"
                                                role="listbox"
                                            >
                                                {filteredOptions.length > 0 ? (
                                                    filteredOptions.map(option => (
                                                        <Flex
                                                            key={option.did}
                                                            align="center"
                                                            cursor="pointer"
                                                            gap={3}
                                                            onMouseDown={(event) => {
                                                                event.preventDefault();
                                                                handleSelect(option);
                                                            }}
                                                            px={3}
                                                            py={2}
                                                            role="option"
                                                            _hover={{ bg: { base: "gray.50", _dark: "gray.700" } }}
                                                        >
                                                            <Avatar size="sm" src={option.avatar} name={option.name} />
                                                            <Box minW={0}>
                                                                <Text fontWeight="medium" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                                                    {option.name}
                                                                </Text>
                                                                <Text color="gray.500" fontSize="sm" overflow="hidden" textOverflow="ellipsis" whiteSpace="nowrap">
                                                                    {truncateMiddle(option.did, 32)}
                                                                </Text>
                                                            </Box>
                                                        </Flex>
                                                    ))
                                                ) : (
                                                    <Box color="gray.500" px={3} py={2}>
                                                        No users found
                                                    </Box>
                                                )}
                                            </Box>
                                        )}
                                    </Box>
                                </Field.Root>
                            </Box>
                        </Box>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    );
};

export default AddGroupMemberModal;
