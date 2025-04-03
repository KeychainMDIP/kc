import React, { useState } from "react";
import { Box, Button, IconButton, MenuItem, Select, TextField, Tooltip, Typography } from "@mui/material";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useUIContext } from "../../shared/contexts/UIContext";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { ContentCopy } from "@mui/icons-material";

const SchemaTab = ()=> {
    const {
        keymaster,
        registries,
        setError,
        setSuccess,
    } = useWalletContext();
    const {
        handleCopyDID,
        refreshNames,
    } = useUIContext();
    const {
        nameList,
        schemaList,
    } = useCredentialsContext();
    const [registry, setRegistry] = useState<string>('hyperswarm');
    const [schemaName, setSchemaName] = useState<string>('');
    const [schemaDID, setSchemaDID] = useState<string>('');
    const [selectedSchemaName, setSelectedSchemaName] = useState<string>('');
    const [editedSchemaName, setEditedSchemaName] = useState<string>('');
    const [selectedSchema, setSelectedSchema] = useState<string>('');
    const [schemaString, setSchemaString] = useState<string>('');

    async function saveSchema() {
        if (!keymaster) {
            return;
        }
        try {
            await keymaster.setSchema(editedSchemaName, JSON.parse(schemaString));
            await editSchema(editedSchemaName);
        } catch (error: any) {
            setError(error.error || error.message || String(error));
            return;
        }
        setSuccess("Schema saved");
    }

    async function editSchema(schemaName: string) {
        if (!keymaster) {
            return;
        }
        try {
            const schema = await keymaster.getSchema(schemaName) as string;
            setSelectedSchema(schema);
            setEditedSchemaName(schemaName);
            setSchemaString(JSON.stringify(schema, null, 4));
        } catch (error: any) {
            setError(error.error || error.message || String(error));
        }
    }

    async function createSchema() {
        if (!keymaster) {
            return;
        }
        try {
            if (Object.keys(nameList).includes(schemaName)) {
                setError(`${schemaName} already in use`);
                return;
            }

            const name = schemaName;
            setSchemaName('');

            const schemaDID = await keymaster.createSchema(null, { registry });
            await keymaster.addName(name, schemaDID);

            await refreshNames();
            setSelectedSchemaName(name);
            await editSchema(name);
        } catch (error: any) {
            setError(error.error || error.message || String(error));
        }
    }

    function populateCopyButton(name: string) {
        setSchemaDID(nameList[name]);
    }

    return (
        <Box display="flex" flexDirection="column">
            <Box className="flex-box mt-2">
                <TextField
                    label="Schema Name"
                    style={{ width: '300px' }}
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
                        className="select-small-left"
                        onChange={(event) => {
                            const selectedName = event.target.value;
                            setSelectedSchemaName(selectedName);
                            populateCopyButton(selectedName);
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
                    <Button
                        variant="contained"
                        color="primary"
                        onClick={() => editSchema(selectedSchemaName)}
                        disabled={!selectedSchemaName}
                        className="button-right"
                    >
                        Edit Schema
                    </Button>
                    {schemaDID &&
                        <Tooltip title="Copy Schema">
                            <IconButton
                                onClick={() => handleCopyDID(schemaDID)}
                                size="small"
                                sx={{
                                    px: 0.5,
                                    ml: 1,
                                }}
                            >
                                <ContentCopy fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    }
                </Box>
            }
            {selectedSchema &&
                <Box display="flex" flexDirection="column" sx={{ mt: 2 }}>
                    <Typography style={{ fontSize: '1.5em', fontFamily: "Courier, monospace" }}>
                        {`Editing: ${editedSchemaName}`}
                    </Typography>

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
