import React, { useEffect, useState } from "react";
import { Button, Input, Text, Field, Group, Dialog } from "@chakra-ui/react";
import { LuCamera } from "react-icons/lu"
import { scanQrCode } from "../utils/utils";

interface AddUserModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (did: string, name: string) => void;
    errorText: string,
}

const AddUserModal: React.FC<AddUserModalProps> = ({ isOpen, onClose, onSubmit, errorText }) => {
    const [did, setDid] = useState("");
    const [name, setName] = useState("");
    const [localError, setLocalError] = useState("");
    const combinedError = localError || errorText || "";

    useEffect(() => {
        if (!isOpen) {
            setDid("");
            setName("");
            setLocalError("");
        }
    }, [isOpen]);

    function handleConfirm(e: React.FormEvent) {
        e.preventDefault();
        const d = did.trim();
        const n = name.trim();
        if (!d || !n) {
            setLocalError("Both DID and Name are required");
            return;
        }
        onSubmit(d, n);
    }

    async function scanQR() {
        const qr = await scanQrCode();
        if (!qr) {
            setLocalError("Failed to scan QR code");
            return;
        }

        setDid(qr);
    }

    return (
        <Dialog.Root open={isOpen}>
            <Dialog.Backdrop />
            <Dialog.Content>
                <Dialog.Header>
                    <Dialog.Title>Add User</Dialog.Title>
                    <Dialog.CloseTrigger />
                </Dialog.Header>
                <Dialog.Body>
                    {combinedError && (
                        <Text color="red.500" mb={2}>
                            {combinedError}
                        </Text>)
                    }
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
                    <Button variant="outline" onClick={onClose}>Cancel</Button>
                    <Button colorScheme="blue" type="submit" form="add-user-form">Add</Button>
                </Dialog.Footer>
            </Dialog.Content>
        </Dialog.Root>
    );
};

export default AddUserModal;
