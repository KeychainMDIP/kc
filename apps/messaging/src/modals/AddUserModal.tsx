import React, { useEffect, useState } from "react";
import { Button, Input, Text, Field, Group, Dialog } from "@chakra-ui/react";
import { LuCamera } from "react-icons/lu"
import { scanQrCode } from "../utils/utils";

interface AddUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (did: string, name: string) => void;
}

const AddUserModal: React.FC<AddUserModalProps> = ({ isOpen, onClose, onSubmit }) => {
    const [did, setDid] = useState("");
    const [name, setName] = useState("");
    const [error, setError] = useState("");

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

    async function scanQR() {
        const qr = await scanQrCode();
        if (!qr) {
            setError("Failed to scan QR code");
            return;
        }

        setDid(qr);
    }

    return (
        <Dialog.Root
            open={isOpen}
            onOpenChange={(e: { open: boolean }) => {
                if (!e.open) {
                    onClose();
                }
            }}
        >
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title>Add User</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
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
                            <Group attached width="100%">
                                <Input
                                    id="add-user-did"
                                    type="text"
                                    value={did}
                                    onChange={(e) => setDid(e.target.value)}
                                    placeholder="did:mdip:..."
                                />
                                <Button variant="outline" onClick={scanQR}>
                                    <LuCamera />
                                </Button>
                            </Group>
                        </Field.Root>
                    </form>
                </Dialog.Body>
                <Dialog.Footer>
                    <Button variant="outline" onClick={handleClose}>Cancel</Button>
                    <Button colorScheme="blue" type="submit" form="add-user-form">Add</Button>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default AddUserModal;
