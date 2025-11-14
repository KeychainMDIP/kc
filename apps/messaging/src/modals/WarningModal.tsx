import React from "react";
import BaseModal from "./BaseModal";
import { Button, Text } from "@chakra-ui/react";

interface WarningModalProps {
    isOpen: boolean;
    title: string;
    warningText: string;
    onSubmit: () => void;
    onClose: () => void;
}

const WarningModal: React.FC<WarningModalProps> = ({ isOpen, title, warningText, onSubmit, onClose }) => {
    return (
        <BaseModal
            isOpen={isOpen}
            title={title}
            onClose={onClose}
            actions={(
                <>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button colorScheme="blue" onClick={onSubmit}>Confirm</Button>
                </>
            )}
        >
            <Text opacity={0.9}>{warningText}</Text>
        </BaseModal>
    );
};

export default WarningModal;
