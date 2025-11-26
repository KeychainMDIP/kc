import React, {ChangeEvent, useEffect, useState} from "react";
import {Box, Button, IconButton, MenuItem, Select, Tooltip} from "@mui/material";
import {Edit} from "@mui/icons-material";
import {useWalletContext} from "../contexts/WalletProvider";
import {useUIContext} from "../contexts/UIContext";
import {useVariablesContext} from "../contexts/VariablesProvider";
import { useSnackbar } from "../contexts/SnackbarProvider";
import { ImageAsset } from "@mdip/keymaster/types";
import { MdipDocument } from "@mdip/gatekeeper/types";
import GatekeeperClient from "@mdip/gatekeeper/client";
import VersionNavigator from "./VersionNavigator";
import TextInputModal from "../modals/TextInputModal";
import CopyResolveDID from "./CopyResolveDID";

const gatekeeper = new GatekeeperClient();

const ImageTab = () => {
    const { keymaster } = useWalletContext();
    const { setError, setSuccess } = useSnackbar();
    const { refreshNames } = useUIContext();
    const {
        imageList,
        nameList,
        registries,
    } = useVariablesContext();
    const [registry, setRegistry] = useState<string>('hyperswarm');
    const [selectedImageName, setSelectedImageName] = useState<string>('');
    const [selectedImage, setSelectedImage] = useState<ImageAsset | null>(null);
    const [selectedImageDocs, setSelectedImageDocs] = useState<MdipDocument | null>(null);
    const [selectedImageDataUrl, setSelectedImageDataUrl] = useState<string>("");
    const [imageVersion, setImageVersion] = useState<number>(1);
    const [imageVersionMax, setImageVersionMax] = useState<number>(1);
    const [renameOpen, setRenameOpen] = useState<boolean>(false);
    const [renameOldName, setRenameOldName] = useState<string>("");

    useEffect(() => {
        const init = async () => {
            const { gatekeeperUrl } = await chrome.storage.sync.get([
                "gatekeeperUrl",
            ]);
            await gatekeeper.connect({ url: gatekeeperUrl });
        }
        init();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (selectedImageName) {
            setImageVersionMax(1);
            refreshImage(selectedImageName);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedImageName]);

    async function refreshImage(name: string, version?: number) {
        if (!keymaster) {
            return;
        }
        try {
            const docs = await keymaster.resolveDID(name, version ? { atVersion: version } : {});
            setSelectedImageDocs(docs);

            const currentVersion = docs.didDocumentMetadata?.version ?? 1;
            setImageVersion(currentVersion);
            if (version === undefined) {
                setImageVersionMax(currentVersion);
            }

            const docAsset = docs.didDocumentData as { image? :ImageAsset };
            if (!docAsset.image || !docAsset.image.cid) {
                setError(`No image data found in version ${currentVersion}`);
                return;
            }
            setSelectedImage(docAsset.image);

            const raw = await gatekeeper.getData(docAsset.image.cid);
            if (!raw) {
                setError(`Could not fetch data for CID: ${docAsset.image.cid}`);
                return;
            }

            const base64 = raw.toString("base64");
            const dataUrl = `data:${docAsset.image.type};base64,${base64}`;
            setSelectedImageDataUrl(dataUrl);
        } catch (error: any) {
            setError(error);
        }
    }

    async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
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
                        setError('Unexpected file reader result');
                        return;
                    }
                    const arrayBuffer = e.target.result;
                    let buffer: Buffer<ArrayBuffer>;
                    if (arrayBuffer instanceof ArrayBuffer) {
                        buffer = Buffer.from(arrayBuffer);
                    } else {
                        setError('Unexpected file reader result type');
                        return;
                    }
                    const did = await keymaster.createImage(buffer, { registry });

                    const nameList = await keymaster.listNames();
                    let name = file.name.slice(0, 26);
                    let count = 1;

                    while (name in nameList) {
                        name = `${file.name.slice(0, 26)} (${count++})`;
                    }

                    await keymaster.addName(name, did);
                    setSuccess(`Image uploaded successfully! DID: ${did}`);

                    await refreshNames();
                    setSelectedImageName(name);
                } catch (error: any) {
                    setError(`Error processing image: ${error}`);
                }
            };

            reader.onerror = (error) => {
                setError(`Error reading file: ${error}`);
            };

            reader.readAsArrayBuffer(file);
        } catch (error: any) {
            setError(`Error uploading image: ${error}`);
        }
    }

    async function updateImage(event: ChangeEvent<HTMLInputElement>) {
        if (!keymaster || !selectedImageName) {
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

                    await keymaster.updateImage(selectedImageName, buffer);

                    setSuccess(`Image updated successfully`);
                    await refreshImage(selectedImageName);
                } catch (error: any) {
                    setError(`Error processing image: ${error}`);
                }
            };

            reader.onerror = (err) => {
                setError(`Error reading file: ${err}`);
            };
            reader.readAsArrayBuffer(file);
        } catch (error: any) {
            setError(`Error uploading image: ${error}`);
        }
    }

    function handleVersionChange(newVer: number) {
        refreshImage(selectedImageName, newVer);
    }

    const openRenameModal = () => {
        setRenameOldName(selectedImageName);
        setRenameOpen(true);
    };

    const handleRenameSubmit = async (newName: string) => {
        setRenameOpen(false);
        if (!newName || !keymaster || newName === selectedImageName) {
            return;
        }
        try {
            const did = nameList[selectedImageName];
            await keymaster.addName(newName, did);
            await keymaster.removeName(selectedImageName);
            await refreshNames();
            setSelectedImageName(newName);
            await refreshImage(newName);
            setSuccess("Image renamed");
        } catch (error: any) {
            setError(error);
        }
    };

    return (
        <Box>
            <TextInputModal
                isOpen={renameOpen}
                title="Rename Image"
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
                    onClick={() => document.getElementById('imageUpload')!.click()}
                    size="small"
                    className="button-right"
                    disabled={!registry}
                >
                    Upload
                </Button>
                <input
                    type="file"
                    id="imageUpload"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={uploadImage}
                />
            </Box>
            {imageList &&
                <Box>
                    <Box className="flex-box mt-2">
                        <Select
                            value={selectedImageName}
                            onChange={(event) => setSelectedImageName(event.target.value)}
                            size="small"
                            variant="outlined"
                            className="select-small-left"
                            sx={{ width: 300 }}
                            displayEmpty
                        >
                            <MenuItem value="" disabled>
                                Select image
                            </MenuItem>
                            {imageList.map((name, index) => (
                                <MenuItem value={name} key={index}>
                                    {name}
                                </MenuItem>
                            ))}
                        </Select>
                        <Button
                            variant="contained"
                            onClick={() => document.getElementById("imageUpdate")!.click()}
                            size="small"
                            className="button-right"
                            disabled={!selectedImageName}
                        >
                            Update
                        </Button>
                        <input
                            type="file"
                            id="imageUpdate"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={updateImage}
                        />
                        <Tooltip title="Rename Image">
                            <span>
                                <IconButton size="small" onClick={openRenameModal} disabled={!selectedImageName} sx={{ ml: 1 }}>
                                    <Edit fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <CopyResolveDID did={nameList[selectedImageName]} />
                    </Box>
                    {selectedImage && selectedImageDocs && selectedImageDataUrl && (
                        <Box sx={{ mt: 2 }}>
                            <VersionNavigator
                                version={imageVersion}
                                maxVersion={imageVersionMax}
                                onVersionChange={handleVersionChange}
                            />
                            <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 2 }}>
                                <Box>
                                    <img
                                        src={selectedImageDataUrl}
                                        alt={selectedImage.cid}
                                        style={{ width: '100%', height: 'auto' }}
                                    />
                                </Box>
                                <Box display="flex" flexDirection="column" gap={1}>
                                    <Box>
                                        <strong>DID:</strong> {selectedImageDocs.didDocument!.id}
                                    </Box>
                                    <Box>
                                        <strong>CID:</strong> {selectedImage.cid}
                                    </Box>
                                    <Box>
                                        <strong>Created:</strong> {selectedImageDocs.didDocumentMetadata!.created}
                                    </Box>
                                    <Box>
                                        <strong>Updated:</strong>{" "}
                                        {selectedImageDocs.didDocumentMetadata!.updated ||
                                            selectedImageDocs.didDocumentMetadata!.created}
                                    </Box>
                                    <Box>
                                        <strong>Version:</strong> {selectedImageDocs.didDocumentMetadata!.version}
                                    </Box>
                                    <Box>
                                        <strong>File size:</strong> {selectedImage.bytes} bytes
                                    </Box>
                                    <Box>
                                        <strong>Image size:</strong> {selectedImage.width} x {selectedImage.height} pixels
                                    </Box>
                                    <Box>
                                        <strong>Image type:</strong> {selectedImage.type}
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                    )}
                </Box>
            }
        </Box>
    );
};

export default ImageTab;
