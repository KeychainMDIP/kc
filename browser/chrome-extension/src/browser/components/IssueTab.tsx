import React, { useEffect, useState } from "react";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import CredentialForm from "./CredentialForm";
import {
    Box,
    Button,
    Select,
    MenuItem,
    InputAdornment,
    TextField,
    Tooltip,
    IconButton,
} from "@mui/material";
import { ContentCopy } from "@mui/icons-material";

function IssueTab() {
    const {
        handleCopyDID,
        keymaster,
        registries,
        registry,
        setError,
        setRegistry,
    } = useWalletContext();
    const {
        agentList,
        credentialDID,
        credentialSchema,
        credentialString,
        credentialSubject,
        schemaList,
        setCredentialDID,
        setCredentialSchema,
        setCredentialString,
        setCredentialSubject,
        setIssuedList,
    } = useCredentialsContext();

    const [schemaObject, setSchemaObject] = useState(null);
    const [isFormValid, setIsFormValid] = useState<boolean>(false);

    async function editCredential() {
        try {
            const credentialBound = await keymaster.bindCredential(
                credentialSchema,
                credentialSubject,
            );
            setCredentialString(JSON.stringify(credentialBound, null, 4));
            setCredentialDID("");
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    async function issueCredential() {
        try {
            const did = await keymaster.issueCredential(
                JSON.parse(credentialString),
                { registry },
            );
            setCredentialDID(did);
            setIssuedList((prevIssuedList: any) => [...prevIssuedList, did]);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    useEffect(() => {
        async function getSchema() {
            try {
                const credentialObject = JSON.parse(credentialString);
                if (
                    !credentialObject.type ||
                    !Array.isArray(credentialObject.type) ||
                    credentialObject.type.length < 2
                ) {
                    setError("Invalid credential object");
                    return;
                }
                const schemaDID = credentialObject.type[1];
                const schemaObject = await keymaster.resolveDID(schemaDID);
                setSchemaObject(schemaObject);
            } catch (error) {
                setError(error.error || error.message || String(error));
            }
        }

        if (credentialString) {
            getSchema();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [credentialString]);

    return (
        <Box sx={{ width: "742px" }}>
            <Box className="flex-row" sx={{ mb: 2 }}>
                <Select
                    style={{ width: "300px" }}
                    value={credentialSubject}
                    onChange={(event) =>
                        setCredentialSubject(event.target.value)
                    }
                    displayEmpty
                    variant="outlined"
                    className="select-small-left"
                >
                    <MenuItem value="" disabled>
                        Select subject
                    </MenuItem>
                    {agentList.map((name, index) => (
                        <MenuItem value={name} key={index}>
                            {name}
                        </MenuItem>
                    ))}
                </Select>
                <Select
                    style={{ width: "300px" }}
                    value={credentialSchema}
                    onChange={(event) =>
                        setCredentialSchema(event.target.value)
                    }
                    displayEmpty
                    variant="outlined"
                    className="select-small"
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
                    onClick={editCredential}
                    disabled={!credentialSubject || !credentialSchema}
                    size="small"
                    className="button-right"
                >
                    Edit Credential
                </Button>
            </Box>
            {credentialString && schemaObject && (
                <>
                    <CredentialForm
                        schemaObject={schemaObject}
                        baseCredential={credentialString}
                        onChange={(credString, valid) => {
                            setCredentialString(credString);
                            setIsFormValid(valid);
                        }}
                    />
                    <Box
                        display="flex"
                        alignItems="center"
                        sx={{ gap: 0, my: 2 }}
                    >
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={issueCredential}
                            className="button-left"
                            disabled={!isFormValid}
                        >
                            Issue Credential
                        </Button>
                        <Select
                            style={{ width: "300px" }}
                            value={registry}
                            className="select-small-right"
                            onChange={(event) =>
                                setRegistry(event.target.value)
                            }
                        >
                            {registries.map((registry, index) => (
                                <MenuItem value={registry} key={index}>
                                    {registry}
                                </MenuItem>
                            ))}
                        </Select>
                    </Box>
                    {credentialDID && (
                        <TextField
                            value={credentialDID}
                            variant="outlined"
                            fullWidth
                            size="small"
                            className="text-field"
                            slotProps={{
                                input: {
                                    readOnly: true,
                                    style: {
                                        fontSize: "1.5em",
                                        fontFamily: "Courier, monospace",
                                    },
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <Tooltip title="Copy DID">
                                                <IconButton
                                                    onClick={() =>
                                                        handleCopyDID(
                                                            credentialDID,
                                                        )
                                                    }
                                                    size="small"
                                                    sx={{ px: 0.5 }}
                                                >
                                                    <ContentCopy fontSize="small" />
                                                </IconButton>
                                            </Tooltip>
                                        </InputAdornment>
                                    ),
                                },
                            }}
                        />
                    )}
                </>
            )}
        </Box>
    );
}

export default IssueTab;
