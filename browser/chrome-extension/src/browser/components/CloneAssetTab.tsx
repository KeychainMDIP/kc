import React, { useState } from "react";
import { Box, TextField, Select, MenuItem, Button } from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useUIContext } from "../../shared/contexts/UIContext";

function CloneAssetTab() {
    const [aliasName, setAliasName] = useState("");
    const [aliasDID, setAliasDID] = useState("");
    const [registry, setRegistry] = useState<string>('hyperswarm');

    const { keymaster, registries, setError } = useWalletContext();
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
        <Box className="flex-box mt-2">
            <TextField
                label="Asset Name"
                size="small"
                style={{ flex: "0 0 150px" }}
                className="text-field single-line"
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
                style={{ flex: "0 0 300px" }}
                className="text-field middle"
                value={aliasDID}
                onChange={(e) => setAliasDID(e.target.value)}
                slotProps={{
                    htmlInput: {
                        maxLength: 80,
                    },
                }}
            />

            <Select
                value={registry}
                size="small"
                variant="outlined"
                className="select-small"
                onChange={(event) => setRegistry(event.target.value as string)}
            >
                {registries?.map((reg: string, idx: number) => (
                    <MenuItem value={reg} key={idx}>
                        {reg}
                    </MenuItem>
                ))}
            </Select>

            <Button
                variant="contained"
                color="primary"
                size="small"
                className="button-right"
                onClick={handleClone}
                disabled={isDisabled}
            >
                Clone Asset
            </Button>
        </Box>
    );
}

export default CloneAssetTab;
