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
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content>
                        <Dialog.Header>
                            <Dialog.Title textAlign="center" flex="1">{title}</Dialog.Title>
                            <Dialog.CloseTrigger />
                        </Dialog.Header>
                        <Dialog.Body>
                            <Text textAlign="center" opacity={0.9}>{warningText}</Text>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="outline" onClick={onClose}>Cancel</Button>
                            <Button colorPalette="blue" onClick={onSubmit}>Confirm</Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    );
};

export default WarningModal;
