import React from "react";
import JsonView from "@uiw/react-json-view";
import { useUIContext } from "../../shared/UIContext";
import {
    Box,
    Button,
    Select,
    MenuItem,
    TextField,
    Typography,
} from "@mui/material";

function IssueTab() {
    const {
        agentList,
        credentialDID,
        credentialSchema,
        credentialString,
        credentialSubject,
        keymaster,
        registries,
        registry,
        schemaList,
        setError,
        setCredentialDID,
        setCredentialSchema,
        setCredentialString,
        setCredentialSubject,
        setIssuedList,
        setRegistry,
    } = useUIContext();

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
            setIssuedList((prevIssuedList) => [...prevIssuedList, did]);
        } catch (error) {
            setError(error.error || error.message || String(error));
        }
    }

    return (
        <Box>
            <Box className="flex-row">
                <Select
                    style={{ width: "300px" }}
                    value={credentialSubject}
                    fullWidth
                    displayEmpty
                    onChange={(event) =>
                        setCredentialSubject(event.target.value)
                    }
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
                    fullWidth
                    displayEmpty
                    onChange={(event) =>
                        setCredentialSchema(event.target.value)
                    }
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
                >
                    Edit Credential
                </Button>
            </Box>
            {credentialString && (
                <>
                    <Box sx={{ display: "flex", flexDirection: "column" }}>
                        <Typography variant="h6" sx={{ my: 1 }}>
                            {`Editing ${credentialSchema} credential for ${credentialSubject}`}
                        </Typography>
                        <TextField
                            value={credentialString}
                            onChange={(e) =>
                                setCredentialString(e.target.value)
                            }
                            multiline
                            rows={20}
                            sx={{ width: "795px", overflow: "auto" }}
                        />
                    </Box>
                    <Box
                        display="flex"
                        alignItems="center"
                        sx={{ gap: 0, my: 1 }}
                    >
                        <Button
                            variant="contained"
                            color="primary"
                            onClick={issueCredential}
                            className="button-left"
                            disabled={!credentialString}
                        >
                            Issue Credential
                        </Button>
                        <Select
                            style={{ width: "300px" }}
                            value={registry}
                            className="select-small"
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
                        <Typography
                            style={{
                                fontSize: "1.5em",
                                fontFamily: "Courier;monospace",
                            }}
                        >
                            {credentialDID}
                        </Typography>
                    )}
                </>
            )}
        </Box>
    );
}

export default IssueTab;
