import React from "react";
import { Button, Text, Dialog, Portal } from "@chakra-ui/react";

interface WarningModalProps {
    isOpen: boolean;
    title: string;
    warningText: string;
    onSubmit: () => void;
    onClose: () => void;
}

const WarningModal: React.FC<WarningModalProps> = ({ isOpen, title, warningText, onSubmit, onClose }) => {
    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open) {
            onClose?.();
        }
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Portal>
                {/* Ensure backdrop overlays any sticky footer (e.g., zIndex 2000 in HomePage) */}
                <Dialog.Backdrop zIndex={2200} bg="blackAlpha.600" />
                <Dialog.Content
                    position="fixed"
                    left={0}
                    right={0}
                    bottom={0}
                    m={0}
                    w="100%"
                    maxW="100%"
                    zIndex={2300}
                    bg={{ base: "white", _dark: "gray.800" }}
                    borderTopRadius="xl"
                    borderBottomRadius={0}
                    boxShadow="lg"
                >
                    <Dialog.Header>
                        <Dialog.Title textAlign="center" flex="1">{title}</Dialog.Title>
                        <Dialog.CloseTrigger />
                    </Dialog.Header>
                    <Dialog.Body>
                        <Text textAlign="center" opacity={0.9}>{warningText}</Text>
                    </Dialog.Body>
                    <Dialog.Footer display="flex" flexDir="column" gap={3}>
                        <Button w="full" colorPalette="red" onClick={onSubmit}>Confirm</Button>
                        <Button w="full" variant="outline" onClick={onClose}>Cancel</Button>
                    </Dialog.Footer>
                </Dialog.Content>
            </Portal>
        </Dialog.Root>
    );
};

export default WarningModal;
