import React, { ReactNode } from "react";
import { Dialog } from "@chakra-ui/react";

interface BaseModalProps {
    isOpen: boolean;
    title?: string;
    onClose?: () => void;
    children?: ReactNode;
    actions?: ReactNode;
    initialFocusRef?: React.RefObject<HTMLElement>;
}

export default function BaseModal({ isOpen, title, onClose, children, actions, initialFocusRef: _initialFocusRef }: BaseModalProps) {
    const handleOpenChange = (e: { open: boolean }) => {
        if (!e.open) {
            (onClose ?? (() => {}))();
        }
    };

    return (
        <Dialog.Root open={isOpen} onOpenChange={handleOpenChange}>
            <Dialog.Backdrop />
            <Dialog.Content>
                {(title || onClose) && (
                    <Dialog.Header>
                        {title && <Dialog.Title>{title}</Dialog.Title>}
                        {onClose && <Dialog.CloseTrigger />}
                    </Dialog.Header>
                )}
                <Dialog.Body>{children}</Dialog.Body>
                {actions && <Dialog.Footer>{actions}</Dialog.Footer>}
            </Dialog.Content>
        </Dialog.Root>
    );
}
