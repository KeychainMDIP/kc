import React, { ChangeEvent, useEffect, useState } from "react";
import {Box, Button, IconButton, MenuItem, Select, Tooltip} from "@mui/material";
import { Edit } from "@mui/icons-material";
import { useWalletContext } from "../contexts/WalletProvider";
import { useUIContext } from "../contexts/UIContext";
import { useVariablesContext } from "../contexts/VariablesProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { FileAsset } from "@mdip/keymaster/types";
import { MdipDocument } from "@mdip/gatekeeper/types";
import GatekeeperClient from "@mdip/gatekeeper/client";
import VersionNavigator from "./VersionNavigator";
import TextInputModal from "../modals/TextInputModal";
import CopyResolveDID from "./CopyResolveDID";

const gatekeeper = new GatekeeperClient();

const DocumentTab = () => {
    const { keymaster } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();
    const { refreshNames } = useUIContext();
    const {
        documentList,
        nameList,
        registries,
    } = useVariablesContext();
    const [registry, setRegistry] = useState<string>("hyperswarm");
    const [selectedDocumentName, setSelectedDocumentName] = useState<string>("");
    const [selectedDocument, setSelectedDocument] = useState<FileAsset | null>(null);
    const [selectedDocumentDocs, setSelectedDocumentDocs] = useState<MdipDocument | null>(null);
    const [selectedDocumentDataUrl, setSelectedDocumentDataUrl] = useState<string>("");
    const [docVersion, setDocVersion] = useState<number>(1);
    const [docVersionMax, setDocVersionMax] = useState<number>(1);
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");

    useEffect(() => {
        const init = async () => {
            const { gatekeeperUrl } = await chrome.storage.sync.get(["gatekeeperUrl"]);
            await gatekeeper.connect({ url: gatekeeperUrl as string });
        };
        init();
    }, []);

    useEffect(() => {
        if (selectedDocumentName) {
            setDocVersionMax(1);
            refreshDocument(selectedDocumentName);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDocumentName]);

    async function refreshDocument(documentName: string, version?: number) {
        if (!keymaster) {
            return;
        }
        try {
            const docs = await keymaster.resolveDID(documentName, version ? { atVersion: version } : {});
            setSelectedDocumentDocs(docs);

            const currentVersion = parseInt(docs.didDocumentMetadata?.version ?? "1", 10);
            setDocVersion(currentVersion);
            if (version === undefined) {
                setDocVersionMax(currentVersion);
            }

            const docAsset = docs.didDocumentData as { document? : FileAsset};
            if (!docAsset.document || !docAsset.document.cid) {
                setError(`No document data found in version ${currentVersion}`);
                return;
            }
            setSelectedDocument(docAsset.document);

            const raw = await gatekeeper.getData(docAsset.document.cid);
            if (!raw) {
                setError(`Could not fetch data for CID: ${docAsset.document.cid}`);
                return;
            }

            const base64 = raw.toString("base64");
            const dataUrl = `data:${docAsset.document.type};base64,${base64}`;
            setSelectedDocumentDataUrl(dataUrl);
        } catch (error: any) {
            setError(error);
        }
    }

    async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
        if (!keymaster) {
            return;
        }
        try {
            const fileInput = event.target;
            if (!fileInput.files || fileInput.files.length === 0) {
                return;
            }

            const file = fileInput.files[0];
            fileInput.value = "";

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    if (!e.target || !e.target.result) {
                        setError("Unexpected file reader result");
                        return;
                    }
                    const arrayBuffer = e.target.result;
                    let buffer: Buffer;
                    if (arrayBuffer instanceof ArrayBuffer) {
                        buffer = Buffer.from(arrayBuffer);
                    } else {
                        setError("Unexpected file reader result type");
                        return;
                    }

                    const did = await keymaster.createDocument(buffer, {
                        registry,
                        filename: file.name,
                    });

                    const nameList = await keymaster.listNames();
                    let name = file.name.slice(0, 26);
                    let count = 1;

                    while (name in nameList) {
                        name = `${file.name.slice(0, 26)} (${count++})`;
                    }

                    await keymaster.addName(name, did);
                    setSuccess(`Document uploaded successfully: ${name}`);

                    await refreshNames();
                    setSelectedDocumentName(name);
                } catch (error: any) {
                    setError(`Error processing document: ${error}`);
                }
            };

            reader.onerror = (error) => {
                setError(`Error reading file: ${error}`);
            };

            reader.readAsArrayBuffer(file);
        } catch (error: any) {
            setError(`Error uploading document: ${error}`);
        }
    }

    async function updateDocument(event: ChangeEvent<HTMLInputElement>) {
        if (!keymaster || !selectedDocumentName) {
            return;
        }
        try {
            const fileInput = event.target;
            if (!fileInput.files || fileInput.files.length === 0) {
                return;
            }

            const file = fileInput.files[0];
            fileInput.value = "";

            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    if (!e.target || !e.target.result) {
                        setError("Unexpected file reader result");
                        return;
                    }
                    const arrayBuffer = e.target.result;
                    let buffer: Buffer;
                    if (arrayBuffer instanceof ArrayBuffer) {
                        buffer = Buffer.from(arrayBuffer);
                    } else {
                        setError("Unexpected file reader result type");
                        return;
                    }

                    await keymaster.updateDocument(selectedDocumentName, buffer, {
                        filename: file.name,
                    });

                    setSuccess(`Document updated successfully`);
                    await refreshDocument(selectedDocumentName);
                } catch (error: any) {
                    setError(`Error updating document: ${error}`);
                }
            };

            reader.onerror = (error) => {
                setError(`Error reading file: ${error}`);
            };

            reader.readAsArrayBuffer(file);
        } catch (error: any) {
            setError(`Error uploading document: ${error}`);
        }
    }

    function downloadDocument() {
        if (!selectedDocument || !selectedDocumentDataUrl) {
            return;
        }

        const link = document.createElement("a");
        link.href = selectedDocumentDataUrl;
        link.download = selectedDocument.filename || "download.bin";
        link.click();
    }

    function handleVersionChange(newVer: number) {
        refreshDocument(selectedDocumentName, newVer);
    }

    function openRenameModal() {
        setRenameOldName(selectedDocumentName);
        setRenameOpen(true);
    }

    async function handleRenameSubmit(newName: string) {
        setRenameOpen(false);
        if (!keymaster || !newName || newName === selectedDocumentName) {
            return;
        }
        try {
            const did = nameList[selectedDocumentName];
            await keymaster.addName(newName, did);
            await keymaster.removeName(selectedDocumentName);
            await refreshNames();
            setSelectedDocumentName(newName);
            await refreshDocument(newName);
            setSuccess("Document renamed");
        } catch (error: any) {
            setError(error);
        }
    }

    return (
        <Box>
            <TextInputModal
                isOpen={renameOpen}
                title="Rename Document"
                description={`Rename '${renameOldName}'`}
                label="New Name"
                confirmText="Rename"
                defaultValue={renameOldName}
                onSubmit={handleRenameSubmit}
                onClose={() => setRenameOpen(false)}
            />

            <Box className="flex-box mt-2">
                <Select
                    value={registries.includes(registry) ? registry : ""}
                    onChange={(e) => setRegistry(e.target.value)}
                    size="small"
                    variant="outlined"
                    className="select-small-left"
                    sx={{ width: 300 }}
                    displayEmpty
                >
                    {registries.map((r) => (
                        <MenuItem key={r} value={r}>
                            {r}
                        </MenuItem>
                    ))}
                </Select>

                <Button
                    variant="contained"
                    onClick={() => document.getElementById("documentUpload")!.click()}
                    size="small"
                    className="button-right"
                    disabled={!registry}
                >
                    Upload Document
                </Button>
                <input
                    type="file"
                    id="documentUpload"
                    accept=".pdf,.doc,.docx,.txt"
                    style={{ display: "none" }}
                    onChange={uploadDocument}
                />
            </Box>

            {documentList && (
                <Box>
                    <Box className="flex-box mt-2">
                        <Select
                            value={selectedDocumentName}
                            onChange={(event) => setSelectedDocumentName(event.target.value)}
                            size="small"
                            variant="outlined"
                            className="select-small-left"
                            sx={{ width: 300 }}
                            displayEmpty
                        >
                            <MenuItem value="" disabled>
                                Select document
                            </MenuItem>
                            {documentList.map((name, index) => (
                                <MenuItem value={name} key={index}>
                                    {name}
                                </MenuItem>
                            ))}
                        </Select>
                        <Button
                            variant="contained"
                            onClick={() => document.getElementById("documentUpdate")!.click()}
                            size="small"
                            className="button-center"
                            disabled={!selectedDocumentName}
                        >
                            Update
                        </Button>
                        <input
                            type="file"
                            id="documentUpdate"
                            accept=".pdf,.doc,.docx,.txt"
                            style={{ display: "none" }}
                            onChange={updateDocument}
                        />
                        <Button
                            variant="contained"
                            size="small"
                            onClick={downloadDocument}
                            className="button-right"
                            disabled={!selectedDocument || !selectedDocumentDataUrl}
                        >
                            Download
                        </Button>
                        <Tooltip title="Rename Document">
                            <span>
                                <IconButton size="small" onClick={openRenameModal} disabled={!selectedDocumentName} sx={{ ml: 1 }}>
                                    <Edit fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>

                        <CopyResolveDID did={nameList[selectedDocumentName]} />
                    </Box>
                    {selectedDocument && selectedDocumentDocs && selectedDocumentDataUrl && (
                        <Box sx={{ mt: 2 }}>
                            <VersionNavigator
                                version={docVersion}
                                maxVersion={docVersionMax}
                                onVersionChange={handleVersionChange}
                            />

                            <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
                                <Box>
                                    <strong>DID:</strong> {selectedDocumentDocs.didDocument!.id}
                                </Box>
                                <Box>
                                    <strong>CID:</strong> {selectedDocument.cid}
                                </Box>
                                <Box>
                                    <strong>Filename:</strong> {selectedDocument.filename}
                                </Box>
                                <Box>
                                    <strong>Created:</strong>{" "}
                                    {selectedDocumentDocs.didDocumentMetadata!.created}
                                </Box>
                                <Box>
                                    <strong>Updated:</strong>{" "}
                                    {selectedDocumentDocs.didDocumentMetadata!.updated ||
                                        selectedDocumentDocs.didDocumentMetadata!.created}
                                </Box>
                                <Box>
                                    <strong>Version:</strong>{" "}
                                    {selectedDocumentDocs.didDocumentMetadata!.version}
                                </Box>
                                <Box>
                                    <strong>File size:</strong> {selectedDocument.bytes} bytes
                                </Box>
                                <Box>
                                    <strong>Document type:</strong> {selectedDocument.type}
                                </Box>
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default DocumentTab;
