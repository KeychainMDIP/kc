import { useState } from "react";
import {Box, TextField, Select, MenuItem, Button, FormControl} from "@mui/material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useUIContext } from "../contexts/UIContext";
import { useSnackbar } from "../contexts/SnackbarProvider";

function CloneAssetTab() {
    const [aliasName, setAliasName] = useState("");
    const [aliasDID, setAliasDID] = useState("");
    const [registry, setRegistry] = useState<string>('hyperswarm');

    const { keymaster, registries } = useWalletContext();
    const { setError } = useSnackbar();
    const { refreshNames } = useUIContext();

    async function handleClone() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.cloneAsset(aliasDID, { name: aliasName, registry });
            await refreshNames();
            setAliasName("");
            setAliasDID("");
        } catch (error: any) {
            setError("Only assets can be cloned");
        }
    }

    const isDisabled = !aliasName || !aliasDID || !registry;

    return (
        <Box display="flex" flexDirection="column" sx={{ mt: 1, gap: 0 }}>
            <TextField
                label="Asset Name"
                size="small"
                sx={{
                    '& .MuiOutlinedInput-notchedOutline': {
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                    },
                }}
                value={aliasName}
                onChange={(e) => setAliasName(e.target.value)}
                slotProps={{
                    htmlInput: {
                        maxLength: 32,
                    },
                }}
            />

            <TextField
                label="Asset DID"
                size="small"
                sx={{
                    '& .MuiOutlinedInput-notchedOutline': {
                        borderRadius: 0,
                    },
                }}
                value={aliasDID}
                onChange={(e) => setAliasDID(e.target.value)}
                slotProps={{
                    htmlInput: {
                        maxLength: 80,
                    },
                }}
            />

            <Box display="flex" flexDirection="row" sx={{ gap: 0, width: "100%" }}>
                <FormControl fullWidth>
                    <Select
                        value={registry}
                        size="small"
                        variant="outlined"
                        sx={{
                            borderTopLeftRadius: 0,
                            borderTopRightRadius: 0,
                            borderBottomRightRadius: 0,
                        }}
                        onChange={(event) => setRegistry(event.target.value as string)}
                    >
                        {registries?.map((reg: string, idx: number) => (
                            <MenuItem value={reg} key={idx}>
                                {reg}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    fullWidth
                    sx={{
                        borderTopLeftRadius: 0,
                        borderTopRightRadius: 0,
                        borderBottomLeftRadius: 0,
                    }}
                    onClick={handleClone}
                    disabled={isDisabled}
                >
                    Clone Asset
                </Button>
            </Box>
        </Box>
    );
}

export default CloneAssetTab;
