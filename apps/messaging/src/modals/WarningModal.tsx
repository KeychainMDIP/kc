import React from "react";
import { Button, Text, Dialog } from "@chakra-ui/react";

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
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title>{title}</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                    <Text opacity={0.9}>{warningText}</Text>
                </Dialog.Body>
                <Dialog.Footer>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button colorScheme="blue" onClick={onSubmit}>Confirm</Button>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default WarningModal;
