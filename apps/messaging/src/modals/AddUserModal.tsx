import React, { useEffect, useRef, useState } from "react";
import BaseModal from "./BaseModal";
import { Button, Input, Text, Field } from "@chakra-ui/react";

interface AddUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (did: string, name: string) => void;
}

const AddUserModal: React.FC<AddUserModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [did, setDid] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const didRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
        if (!isOpen) {
            setDid("");
            setName("");
            setError("");
        }
    }, [isOpen]);

    function handleConfirm(e: React.FormEvent) {
        e.preventDefault();
        const d = did.trim();
        const n = name.trim();
        if (!d || !n) {
            setError("Both DID and Name are required");
            return;
        }
        onSubmit(d, n);
        handleClose();
    }

    function handleClose() {
        setDid("");
        setName("");
        setError("");
        onClose();
    }

    return (
        <BaseModal
            isOpen={isOpen}
            title="Add User"
            onClose={handleClose}
            initialFocusRef={didRef as unknown as React.RefObject<HTMLElement>}
            actions={(
                <>
                    <Button variant="outline" onClick={handleClose}>Cancel</Button>
                    <Button colorScheme="blue" type="submit" form="add-user-form">Add</Button>
                </>
            )}
        >
            {error && <Text color="red.500" mb={2}>{error}</Text>}
            <form id="add-user-form" onSubmit={handleConfirm}>
                <Field.Root>
                    <Field.Label htmlFor="add-user-name">Name</Field.Label>
                    <Input
                        id="add-user-name"
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Display name"
                    />
                </Field.Root>

                <Field.Root mt={3}>
                    <Field.Label htmlFor="add-user-did">DID</Field.Label>
                    <Input
                        id="add-user-did"
                        ref={didRef}
                        type="text"
                        value={did}
                        onChange={(e) => setDid(e.target.value)}
                        placeholder="did:mdip:..."
                    />
                </Field.Root>
            </form>
        </BaseModal>
    );
};

export default AddUserModal;
