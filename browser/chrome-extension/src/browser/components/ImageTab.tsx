import React, {ChangeEvent, useEffect, useState} from "react";
import {Box, Button, MenuItem, Select} from "@mui/material";
import {useWalletContext} from "../../shared/contexts/WalletProvider";
import {useUIContext} from "../../shared/contexts/UIContext";
import {useCredentialsContext} from "../../shared/contexts/CredentialsProvider";
import { ImageAsset } from "@mdip/keymaster/types";
import { MdipDocument } from "@mdip/gatekeeper/types";
import GatekeeperClient from "@mdip/gatekeeper/client";

const gatekeeper = new GatekeeperClient();

const ImageTab = () => {
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
        imageList,
    } = useCredentialsContext();
    const [registry, setRegistry] = useState<string>('hyperswarm');
    const [selectedImageName, setSelectedImageName] = useState<string>('');
    const [selectedImage, setSelectedImage] = useState<ImageAsset | null>(null);
    const [selectedImageDocs, setSelectedImageDocs] = useState<MdipDocument | null>(null);
    const [selectedImageDataUrl, setSelectedImageDataUrl] = useState<string>("");

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

    async function refreshImage(imageName: string) {
        if (!keymaster) {
            return;
        }
        try {
            const image = await keymaster.getImage(imageName);
            if (!image) {
                setError(`Image ${imageName} not found`);
                return;
            }
            setSelectedImage(image);

            const docs = await keymaster.resolveDID(imageName);
            setSelectedImageDocs(docs);

            const raw = await gatekeeper.getData(image.cid);
            const base64 = raw.toString("base64");
            const dataUrl = `data:${image.type};base64,${base64}`;
            setSelectedImageDataUrl(dataUrl);
        } catch (error: any) {
            setError(error.error || error.message || String(error));
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
                    await refreshImage(name);
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

    return (
        <Box>
            <Box className="flex-box mt-2">
                <Select
                    value={
                        registries.length > 0 && registries.includes(registry)
                            ? registry
                            : ""
                    }
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
                            onClick={() => refreshImage(selectedImageName)}
                            size="small"
                            className="button-right"
                            disabled={!selectedImageName}
                        >
                            Show Image
                        </Button>
                    </Box>
                    <Box className="flex-box mt-2">
                        {selectedImage && selectedImageDocs && selectedImageDataUrl &&
                            <Box display="flex" flexDirection="column" gap={2}>
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
                        }
                    </Box>
                </Box>
            }
        </Box>
    );
};

export default ImageTab;
