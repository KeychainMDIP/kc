import React, { MouseEvent, useEffect, useRef, useState } from "react";
import BaseModal from "./BaseModal";
import { Button, Text, Textarea } from "@chakra-ui/react";

interface MnemonicModalProps {
    isOpen: boolean;
    onSubmit: (mnemonic: string) => void;
    onClose: () => void;
}

const MnemonicModal: React.FC<MnemonicModalProps> = ({ isOpen, onSubmit, onClose }) => {
    const [mnemonic, setMnemonic] = useState<string>("");
    const taRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        // Chakra's initialFocusRef isn't passed here; keep manual focus when opened
        if (isOpen) setTimeout(() => taRef.current?.focus(), 0);
    }, [isOpen]);

    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    const canConfirm = words.length === 12;

    const handleSubmit = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        onSubmit(mnemonic);
    };

    return (
        <BaseModal
            isOpen={isOpen}
            title="Import Mnemonic"
            onClose={onClose}
            actions={(
                <>
                    <Button
                        onClick={handleSubmit}
                        colorScheme="blue"
                        disabled={!canConfirm}
                    >
                        Confirm
                    </Button>
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                </>
            )}
        >
            <Text mb={2} opacity={0.9}>
                Please paste or type your 12-word mnemonic below separated by spaces.
            </Text>
            <Textarea
                ref={taRef}
                id="mnemonic"
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
                placeholder="word1 word2 word3... (12 words total)"
            />
        </BaseModal>
    );
};

export default MnemonicModal;
