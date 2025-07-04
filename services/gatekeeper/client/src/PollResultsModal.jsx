import React from "react";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Typography,
} from "@mui/material";

const PollResultsModal = ({ open, onClose, results }) => {
    if (!results) {
        return null;
    }

    const { tally, votes } = results;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>Poll Results</DialogTitle>

            <DialogContent dividers>
                {tally
                    .slice()
                    .sort((a, b) => b.count - a.count)
                    .map((t) => (
                        <Box key={t.vote} display="flex" justifyContent="space-between" my={1}>
                            <Typography>{t.option}</Typography>
                            <Typography>{t.count}</Typography>
                        </Box>
                    ))}

                {votes && (
                    <Box mt={2}>
                        <Typography variant="body2">Eligible voters: {votes.eligible}</Typography>
                        <Typography variant="body2">Ballots received: {votes.received}</Typography>
                        <Typography variant="body2">Pending ballots: {votes.pending}</Typography>
                    </Box>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default PollResultsModal;
