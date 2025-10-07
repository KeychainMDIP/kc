import React, { useEffect, useState } from "react";
import { useWalletContext } from "../../shared/contexts/WalletProvider";
import { useCredentialsContext } from "../../shared/contexts/CredentialsProvider";
import { useSnackbar } from "../../shared/contexts/SnackbarProvider";
import CredentialForm from "./CredentialForm";
import {
    Box,
    Button,
    Select,
    MenuItem,
} from "@mui/material";
import DisplayDID from "../../shared/DisplayDID";

function IssueTab() {
    const {
        keymaster,
        registries,
        registry,
        setRegistry,
    } = useWalletContext();
    const { setError } = useSnackbar();
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

    const [schemaObject, setSchemaObject] = useState<any>(null);
    const [isFormValid, setIsFormValid] = useState<boolean>(false);

    async function editCredential() {
        if (!keymaster) {
            return;
        }
        try {
            const credentialBound = await keymaster.bindCredential(
                credentialSchema,
                credentialSubject,
            );
            setCredentialString(JSON.stringify(credentialBound, null, 4));
            setCredentialDID("");
        } catch (error: any) {
            setError(error);
        }
    }

    async function issueCredential() {
        if (!keymaster) {
            return;
        }
        try {
            const did = await keymaster.issueCredential(
                JSON.parse(credentialString),
                { registry },
            );
            setCredentialDID(did);
            setIssuedList((prevIssuedList) => [...prevIssuedList, did]);
        } catch (error: any) {
            setError(error);
        }
    }

    useEffect(() => {
        async function getSchema() {
            if (!keymaster) {
                return;
            }
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
                const schemaObject = await keymaster.getSchema(schemaDID);
                setSchemaObject(schemaObject);
            } catch (error: any) {
                setError(error);
            }
        }

        if (credentialString) {
            getSchema();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [credentialString]);

    return (
        <Box>
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
                    {credentialDID &&
                        <DisplayDID did={credentialDID} />
                    }
                </>
            )}
        </Box>
    );
}

export default IssueTab;
