import { useState } from "react";
import {Box, Button, FormControl, IconButton, MenuItem, Select, TextField, Tooltip} from "@mui/material";
import { useWalletContext } from "../contexts/WalletProvider";
import {useSnackbar} from "../contexts/SnackbarProvider";
import { useUIContext } from "../contexts/UIContext";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { Edit } from "@mui/icons-material";
import TextInputModal from "../modals/TextInputModal";
import CopyResolveDID from "./CopyResolveDID";
import { useThemeContext } from "../contexts/ContextProviders";

const SchemaTab = ()=> {
    const { keymaster } = useWalletContext();
    const {
        setError,
        setSuccess,
    } = useSnackbar();
    const {
        refreshNames,
    } = useUIContext();
    const {
        registries,
        nameList,
        schemaList,
    } = useVariablesContext();
    const { isTabletUp } = useThemeContext();
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
        <Box display="flex" flexDirection="column"  sx={{ mt: 1 }}>
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

            <Box display="flex" flexDirection="column" sx={{ mb: 2, gap: 0, width: isTabletUp ? '70%' : '100%', mx: isTabletUp ? 'auto' : 0 }}>
                <TextField
                    label="Schema Name"
                    size="small"
                    sx={{
                        borderBottomLeftRadius: 0,
                        borderBottomRightRadius: 0,
                    }}
                    value={schemaName}
                    onChange={(e) => setSchemaName(e.target.value)}
                    slotProps={{
                        htmlInput: {
                            maxLength: 32,
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
                            onChange={(event) => setRegistry(event.target.value)}
                        >
                            {registries.map((registry, index) => (
                                <MenuItem value={registry} key={index}>
                                    {registry}
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
                        onClick={createSchema}
                        disabled={!schemaName}
                    >
                        Create
                    </Button>
                </Box>
            </Box>

            {schemaList &&
                <Box sx={{ display: "flex", alignItems: "center", width: isTabletUp ? '70%' : '100%', mx: isTabletUp ? 'auto' : 0, flexWrap: "nowrap" }}>
                    <FormControl sx={{ flex: 1, minWidth: 0 }}>
                        <Select
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
                    </FormControl>

                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, whiteSpace: "nowrap" }}>
                        <Tooltip title="Rename">
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={openRenameModal}
                                    disabled={!selectedSchemaName}
                                >
                                    <Edit fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <CopyResolveDID did={nameList[selectedSchemaName] ?? ""} />
                    </Box>
                </Box>
            }
            {schemaString &&
                <Box display="flex" flexDirection="column">
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
