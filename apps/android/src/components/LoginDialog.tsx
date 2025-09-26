import React, { useEffect, useState } from "react";
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    TextField,
    IconButton,
    InputAdornment
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";

interface LoginDialogProps {
    open: boolean;
    onClose: () => void;
    onOK?: (service: string, username: string, password: string) => void;
    login?: { service: string; username: string; password: string } | null;
    readOnly?: boolean;
}

const LoginDialog: React.FC<LoginDialogProps> = ({
    open,
    onClose,
    onOK,
    login,
    readOnly = false,
}) => {
    const [service, setService] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);

    useEffect(() => {
        setService(login?.service || "");
        setUsername(login?.username || "");
        setPassword(login?.password || "");
        setShowPassword(false);
    }, [login, open]);

    const handleSubmit = () => {
        if (onOK) {
            onOK(service, username, password);
        } else {
            onClose();
        }
    };

    const handleClose = () => {
        setService("");
        setUsername("");
        setPassword("");
        setShowPassword(false);
        onClose();
    };

    const handleClickShowPassword = () => setShowPassword((prev) => !prev);
    const handleMouseDownPassword = (
        event: React.MouseEvent<HTMLButtonElement>
    ) => {
        event.preventDefault();
    };

    return (
        <Dialog open={open} onClose={handleClose}>
            <DialogTitle>Login</DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    margin="dense"
                    label="Service"
                    fullWidth
                    value={service}
                    onChange={(e) => setService(e.target.value)}
                    InputProps={{ readOnly }}
                />
                <TextField
                    margin="dense"
                    label="Username"
                    fullWidth
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    InputProps={{ readOnly }}
                />
                <TextField
                    margin="dense"
                    label="Password"
                    fullWidth
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    InputProps={{
                        readOnly,
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton
                                    onClick={handleClickShowPassword}
                                    onMouseDown={handleMouseDownPassword}
                                    edge="end"
                                >
                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} variant="contained" color="primary">
                    Cancel
                </Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    color="primary"
                    disabled={!service || !username || !password}
                >
                    OK
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default LoginDialog;
