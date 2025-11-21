import React, {FormEvent} from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    DialogContentText,
} from "@mui/material";
import { useThemeContext } from "../contexts/ContextProviders";

interface WarningModalProps {
    isOpen: boolean;
    title: string;
    warningText: string;
    onSubmit: () => void;
    onClose: () => void;
}

const WarningModal: React.FC<WarningModalProps> = ({ isOpen, title, warningText, onSubmit, onClose }) => {
    const { isTabletUp } = useThemeContext();

    if (!isOpen) {
        return null;
    }

    function handleSubmit(e: FormEvent<HTMLFormElement>) {
        e.preventDefault();
        onSubmit();
    }

    function handleClose() {
        onClose();
    }

    return (
        <Dialog
            open={isOpen}
            onClose={handleClose}
            maxWidth="lg"
            fullWidth
            slotProps={{
                paper: {
                    sx: {
                        width: isTabletUp ? '50%' : '100%'
                    }
                }
            }}
        >
            <form onSubmit={handleSubmit}>
                <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
                <DialogContent>
                    <DialogContentText id="confirm-dialog-description">
                        {warningText}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button
                        type="submit"
                        variant="contained"
                        color="primary"
                    >
                        Confirm
                    </Button>
                    <Button onClick={handleClose} color="primary">
                        Cancel
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
};

export default WarningModal;
