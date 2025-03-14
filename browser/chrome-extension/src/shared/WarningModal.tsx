import React from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    DialogContentText,
} from "@mui/material";

interface WarningModalProps {
    isOpen: boolean;
    title: string;
    warningText: string;
    onSubmit: () => void;
    onClose: () => void;
}

const WarningModal: React.FC<WarningModalProps> = ({ isOpen, title, warningText, onSubmit, onClose }) => {
    if (!isOpen) return null;

    function handleSubmit(e) {
        e.preventDefault();
        onSubmit();
    }

    function handleClose() {
        onClose();
    }

    return (
        <Dialog open={isOpen} onClose={handleClose}>
            <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
            <DialogContent>
                <DialogContentText id="confirm-dialog-description">
                    {warningText}
                </DialogContentText>
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={handleSubmit}
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
        </Dialog>
    );
};

export default WarningModal;
