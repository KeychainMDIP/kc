import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    Typography,
    Box
} from '@mui/material';

const PassphraseModal = ({ isOpen, title, errorText, onSubmit, onClose }) => {
    const [passphrase, setPassphrase] = useState('');

    if (!isOpen) return null;

    function handleSubmit(e) {
        e.preventDefault();
        onSubmit(passphrase);
        setPassphrase('');
    }

    function handleClose(){
        onClose();
        setPassphrase('');
    }

    return (
        <Dialog open={isOpen} onClose={handleClose}>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent>
                {errorText && (
                    <Box mb={2}>
                        <Typography color="error">{errorText}</Typography>
                    </Box>
                )}
                <form onSubmit={handleSubmit} id="passphrase-form">
                    <TextField
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        required
                        autoFocus
                        fullWidth
                        variant="outlined"
                        margin="dense"
                    />
                </form>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} color="secondary">
                    Cancel
                </Button>
                <Button type="submit" form="passphrase-form" variant="contained" color="primary">
                    Submit
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default PassphraseModal;
