import React, { MouseEvent, useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    DialogContentText,
    TextField,
} from "@mui/material";

interface MnemonicModalProps {
    isOpen: boolean;
    onSubmit: (mnemonic: string) => void;
    onClose: () => void;
}

const MnemonicModal: React.FC<MnemonicModalProps> = ({ isOpen, onSubmit, onClose }) => {
    const [mnemonic, setMnemonic] = useState<string>("");

    const words = mnemonic.trim().split(/\s+/).filter(Boolean);
    const canConfirm = words.length === 12;

    const handleSubmit = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        onSubmit(mnemonic);
        setMnemonic("");
    };

    const handleClose = () => {
        onClose();
        setMnemonic("");
    };

    return (
        <Dialog open={isOpen} onClose={handleClose}>
            <DialogTitle>Import Mnemonic</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    Please paste or type your 12-word mnemonic below separated by spaces.
                </DialogContentText>
                <TextField
                    autoFocus
                    margin="dense"
                    id="mnemonic"
                    fullWidth
                    multiline
                    minRows={3}
                    value={mnemonic}
                    onChange={(e) => setMnemonic(e.target.value)}
                    placeholder="word1 word2 word3... (12 words total)"
                />
            </DialogContent>
            <DialogActions>
                <Button
                    onClick={handleSubmit}
                    type="submit"
                    variant="contained"
                    color="primary"
                    disabled={!canConfirm}
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

export default MnemonicModal;
