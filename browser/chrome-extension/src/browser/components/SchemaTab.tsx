import React, { useState } from "react";
import { Box, Button, IconButton, MenuItem, Select, TextField, Tooltip } from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { Edit } from "@mui/icons-material";
import TextInputModal from "../../shared/TextInputModal";
import CopyResolveDID from "../../shared/CopyResolveDID";

const SchemaTab = ()=> {
    const {
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const {
        refreshNames,
    } = useUIContext();
    const {
        nameList,
        schemaList,
    } = useCredentialsContext();
    const [registry, setRegistry] = useState<string>('hyperswarm');
    const [schemaName, setSchemaName] = useState<string>('');
    const [selectedSchemaName, setSelectedSchemaName] = useState<string>('');
    const [schemaString, setSchemaString] = useState<string>('');
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");

    const saveSchema = async () => {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.setSchema(selectedSchemaName, JSON.parse(schemaString));
            await editSchema(selectedSchemaName);
            setSuccess("Schema saved");
        } catch (error: any) {
            setError(error);
        }
    };

    const editSchema = async (name: string) => {
        if (!keymaster || !name) {
            return;
        }
        try {
            const schema = (await keymaster.getSchema(name)) as unknown as object;
            setSchemaString(JSON.stringify(schema, null, 4));
        } catch (error: any) {
            setError(error);
        }
    };

    async function createSchema() {
        if (!keymaster) {
            return;
        }

        const name = schemaName.trim();
        if (name in nameList) {
            setError(`${name} already in use`);
            return;
        }

        setSchemaName('');

        try {
            const schemaDID = await keymaster.createSchema(null, { registry });
            await keymaster.addName(name, schemaDID);

            await refreshNames();
            setSelectedSchemaName(name);
            await editSchema(name);
        } catch (error: any) {
            setError(error);
        }
    }

    const openRenameModal = () => {
        setRenameOldName(selectedSchemaName);
        setRenameOpen(true);
    };

    const handleRenameSubmit = async (newName: string) => {
        setRenameOpen(false);
        if (!newName || newName === selectedSchemaName || !keymaster) {
            return;
        }

        const name = newName.trim();
        if (name in nameList) {
            setError(`${name} already in use`);
            return;
        }

        try {
            await keymaster.addName(name, nameList[selectedSchemaName]);
            await keymaster.removeName(selectedSchemaName);
            await refreshNames();
            setSelectedSchemaName(name);
            setRenameOldName("");
            setSuccess("Schema renamed");
        } catch (error: any) {
            setError(error);
        }
    };

    return (
        <Box display="flex" flexDirection="column">
            <TextInputModal
                isOpen={renameOpen}
                title="Rename Schema"
                description={`Rename '${renameOldName}' to:`}
                label="New Name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <Box className="flex-box mt-2">
                <TextField
                    label="Schema Name"
                    style={{ flex: "0 0 400px" }}
                    className="text-field single-line"
                    size="small"
                    value={schemaName}
                    onChange={(e) => setSchemaName(e.target.value)}
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
                    onChange={(event) => setRegistry(event.target.value)}
                >
                    {registries.map((registry, index) => (
                        <MenuItem value={registry} key={index}>
                            {registry}
                        </MenuItem>
                    ))}
                </Select>
                <Button
                    variant="contained"
                    color="primary"
                    size="small"
                    className="button-right"
                    onClick={createSchema}
                    disabled={!schemaName}
                >
                    Create Schema
                </Button>
            </Box>
            {schemaList &&
                <Box className="flex-box mt-2">
                    <Select
                        style={{ width: '300px' }}
                        value={selectedSchemaName}
                        displayEmpty
                        variant="outlined"
                        size="small"
                        onChange={async (event) => {
                            const name = event.target.value;
                            setSelectedSchemaName(name);
                            await editSchema(name);
                        }}
                    >
                        <MenuItem value="" disabled>
                            Select schema
                        </MenuItem>
                        {schemaList.map((name, index) => (
                            <MenuItem value={name} key={index}>
                                {name}
                            </MenuItem>
                        ))}
                    </Select>
                    <Tooltip title="Rename Schema">
                        <span>
                            <IconButton
                                size="small"
                                onClick={openRenameModal}
                                disabled={!selectedSchemaName}
                                sx={{ ml: 1 }}
                            >
                                <Edit fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>

                    <CopyResolveDID did={nameList[selectedSchemaName] ?? ""} />
                </Box>
            }
            {schemaString &&
                <Box display="flex" flexDirection="column" sx={{ mt: 2 }}>
                    <TextField
                        value={schemaString}
                        onChange={(e) => setSchemaString(e.target.value)}
                        multiline
                        rows={20}
                        fullWidth
                        variant="outlined"
                        sx={{ my: 2 }}
                        slotProps={{
                            input: {
                                style: {
                                    fontSize: "1em",
                                    fontFamily: "Courier, monospace",
                                },
                            }
                        }}
                    />
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={saveSchema}
                        disabled={!schemaString}
                        sx={{ width: 150 }}
                    >
                        Save Schema
                    </Button>
                </Box>
            }
        </Box>
    );
}

export default SchemaTab;
